'use strict';
/**
 * Search for sonos ZonePlayer:1 devices, and parse device description.
 */

const
  dgram = require("dgram"),
  Rx = require('rx'),
  url = require('url'),
  camelCase = require("camel-case"),
  rxutil = require("./rxutil");

const
  multicastAdr = '239.255.255.250',
  multicastPort = 1900,
  zonePlayerDeviceURN = 'urn:schemas-upnp-org:device:ZonePlayer:1',
  searchMsg = 'M-SEARCH * HTTP/1.1\n' +
    'HOST: 239.255.255.250:1900\n' +
    'MAN: "ssdp:discover\n' +
    'MX: 1\n' +
    'ST: ' + zonePlayerDeviceURN + "\n\n";

function formatDeviceTypeName(urn) {
  const urnParts = urn.split(":");
  const name = urnParts[urnParts.length - 2];
  return camelCase(name);
}

// Clean up the xml2js-generated device info object to
// make it easier to work with, and add the root device url host
// to all services and devices.
function cleanupDeviceData(device, hostUrl) {
  device.hostUrl = hostUrl;
  device.devices = {};
  if (device.deviceList) {
    (device.deviceList.device || []).
      forEach(subDev => {
        device.devices[formatDeviceTypeName(subDev.deviceType)] = cleanupDeviceData(subDev, hostUrl);
      });
    delete device.deviceList;
  }

  device.services = {};
  if (device.serviceList) {
    device.serviceList.service.forEach(service => {
      service.hostUrl = hostUrl;
      device.services[formatDeviceTypeName(service.serviceType)] = service;
    });
    delete device.serviceList;
  }

  return device;
}

function createActionList(scpdObj) {
  var actions = scpdObj.actionList.action || [];
  if (!Array.isArray(actions)) {
    actions = [actions];
  }
  return actions.map(action => ({
    name: action.name,
    argumentList: (action.argumentList && action.argumentList.argument) || []
  }), {});
}

function createStateVarsList(scpdObj) {
  const stateVariables = scpdObj.serviceStateTable.stateVariable;
  return stateVariables.map(stateVar => ({
    name: stateVar.name,
    dataType: stateVar.dataType,
    defaultValue: stateVar.defaultValue,
    allowedValues: (stateVar.allowedValueList && stateVar.allowedValueList.allowedValue)
  }));
}

// Go through all services on the devices, including
// services on sub-devices, and parse the scpd info
function addServiceInfo(device) {
  // recursivly find all services
  const services = (function allServices(device) {
    if (!device) {
      return [];
    }
    const devices = Object.keys(device.devices).map(name => device.devices[name]);
    const services = Object.keys(device.services).map(name => device.services[name]);
    return Array.prototype.concat.apply(services, devices.map(allServices));
  })(device)
    .filter(service => service.SCPDURL);

  const totalLookups = services.length;
  var numLookupsCompleted = 0;

  return new Rx.Observable(obs => {
    services.forEach(service => {
      rxutil.httpObservable("http://" + service.hostUrl + service.SCPDURL).
        flatMap(resp => rxutil.xmlParseObservable(resp.body)).
        subscribe(parsedResp => {
          service.actions = createActionList(parsedResp.scpd);
          service.stateVariables = createStateVarsList(parsedResp.scpd);
          numLookupsCompleted += 1;
          if (numLookupsCompleted === totalLookups) {
            obs.onNext(device);
            obs.onCompleted();
          }
        });
    });
  }).timeout(10000, new Error("Timed out reading service info for " + device.roomName));
}

// Search for devices and look up device info
function createZonePlayer(ssdpHeaders) {
  const deviceHost = url.parse(ssdpHeaders.LOCATION).host;
  return rxutil.httpObservable(ssdpHeaders.LOCATION).
    flatMap(resp => rxutil.xmlParseObservable(resp.body)).
    map(deviceDesc => cleanupDeviceData(deviceDesc.root.device, deviceHost)).
    flatMap(addServiceInfo);
}

// parse the header-formatted result body from a m-search response
function parseSearchResponse(udpMsg) {
  const msgLines = udpMsg.toString().split("\r\n");
  return msgLines.slice(1).reduce(function (headers, line) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      headers[line.substr(0, colonIndex).trim()] = line.substr(colonIndex + 1).trim();
    }
    return headers;
  }, {});
}

const seenDevices = {};
const newDevices = new Rx.Subject();
const zonePlayerStream = newDevices.flatMap(createZonePlayer);

/**
 * Send out a search for ZonePlayer:1 devices.
 */
function search() {
  const searchSock = dgram.createSocket('udp4');
  searchSock.bind();
  searchSock.on('message', function (msg) {
    msg = parseSearchResponse(msg);
    if (!seenDevices[msg.USN]) {
      newDevices.onNext(msg);
      seenDevices[msg.USN] = msg;
    }
  });
  searchSock.send(searchMsg, 0, searchMsg.length, multicastPort, multicastAdr);
  setTimeout(() => searchSock.close(), 5000);
}

module.exports = {
  zonePlayerStream: zonePlayerStream,
  search: search
};

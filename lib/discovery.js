'use strict';
/**
 * Search for sonos ZonePlayer:1 devices, and parse device description.
 */

const
  dgram = require('dgram'),
  Rx = require('rx'),
  url = require('url'),
  camelCase = require('camel-case'),
  rxutil = require('./rxutil');

const
  multicastAdr = '239.255.255.250',
  multicastPort = 1900,
  zonePlayerDeviceURN = 'urn:schemas-upnp-org:device:ZonePlayer:1',
  searchMsg = 'M-SEARCH * HTTP/1.1\n' +
    'HOST: 239.255.255.250:1900\n' +
    'MAN: ssdp:discover\n' +
    'MX: 1\n' +
    'ST: ' + zonePlayerDeviceURN + '\n\n';

function formatDeviceTypeName(urn) {
  const urnParts = urn.split(':');
  const name = urnParts[urnParts.length - 2];
  return camelCase(name);
}

// Clean up the xml2js-generated device info object,
// and add the root device url host to all services and devices.
function cleanupDeviceData(device, hostUrl) {
  device.hostUrl = hostUrl;

  ((device.deviceList || {}).device || [])
    .forEach(subDev => {
      device[formatDeviceTypeName(subDev.deviceType)] = cleanupDeviceData(subDev, hostUrl);
    });
  delete device.deviceList;

  ((device.serviceList || {}).service || [])
    .forEach(service => {
      service.hostUrl = hostUrl;
      device[formatDeviceTypeName(service.serviceType)] = service;
    });
  delete device.serviceList;

  return device;
}

// Search for devices and look up device info
function createZonePlayer(ssdpHeaders) {
  const deviceHost = url.parse(ssdpHeaders.LOCATION).host;
  return rxutil.httpObservable(ssdpHeaders.LOCATION)
    .flatMap(resp => rxutil.xmlParseObservable(resp.body))
    .map(deviceDesc => cleanupDeviceData(deviceDesc.root.device, deviceHost));
}

// parse the header-formatted result body from an m-search response
function parseSearchResponse(udpMsg) {
  const msgLines = udpMsg.toString().split('\r\n');
  return msgLines.slice(1).reduce(function (headers, line) {
    const colonIndex = line.indexOf(':');
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

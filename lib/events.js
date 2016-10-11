'use strict';

const
  Rx = require('rx'),
  http = require('http'),
  ip = require('ip'),
  concat = require('concat-stream'),
  merge = require('merge'),
  rxutil = require('./rxutil');


let eventServer;
const  subscriptionTimeoutSecs = 3600;

const registredSubscriptions = {};  // subscriptionId -> device and service the subscription is for.

// The services we set up event-subscriptions for
const eventServices = {
  deviceProps: zp => zp.deviceProperties,
  topology: zp => zp.zoneGroupTopology,
  avt: zp => zp.mediaRenderer.avtransport,
  queue: zp => zp.mediaRenderer.queue,
  rendering: zp => zp.mediaRenderer.renderingControl,
  groupRendering: zp => zp.mediaRenderer.groupRenderingControl
};

/**
 * Start subscribing to events on the given service.
 * The observable returned here is only for the subscription request
 * itself, any events will be published on the event-stream under the given eventTag
 * identifier.
 */
function subscribe(zonePlayer) {
  const subscriptions = Object.keys(eventServices)
    .map(serviceTag =>
      subscribeToService(zonePlayer, serviceTag));
  return Rx.Observable.merge(subscriptions);
}

/**
 * Stream of all received events for all devices.
 */
const eventStream = Rx.Observable.create(obs => {

  eventServer = http.createServer(function (req, resp) {
    const subId = req.headers.sid;
    if (!registredSubscriptions[subId]) {
      console.log('unrecongnized subId', subId);
      resp.end();
      return;
    }
    resp.statusCode = 200;
    req.pipe(concat(function (body) {
      resp.end();
      parseEventData(body.toString())
        .subscribe(eventObj => {
          obs.onNext({
            data: eventObj,
            zpUDN: registredSubscriptions[subId].zpUDN,
            serviceTag: registredSubscriptions[subId].serviceTag,
            service: registredSubscriptions[subId].service
          });
        });
    }));
  }).listen(() => console.log('listening for events at', eventServer.address().port));
}).share();

// Extract an event object from from the raw xml event msg.
// note: some events, such as the avt lastChange event,
// contain raw html-encoded xml data. Parsing this data is not handled here.
function parseEventData(eventData) {
  return rxutil.xmlParseObservable(eventData)
    .map(eventObj => {
      const eventProperty = eventObj.ePropertyset.eProperty;
      if (Array.isArray(eventProperty)) {
        return merge.apply(null, eventProperty);
      }
      else {
        return eventProperty;
      }
    });
}

// send a renewal request for the given subscription-id
function renewSubscription(eventUrl, subId) {
  return rxutil.httpObservable({
    uri: eventUrl,
    method: 'SUBSCRIBE',
    headers: {
      SID: subId,
      TIMEOUT: 'Second-' + subscriptionTimeoutSecs
    }
  });
}

// parse the returned subscription-response headers and set up
// automatic renewal of the subscription
function setupSubscriptionRenewal(eventUrl, subHeaders) {
  const timeout = parseInt(subHeaders.timeout.split('-')[1], 10);
  const subId = subHeaders.sid;
  setInterval(() => {
    renewSubscription(eventUrl, subId).
      subscribe(() => console.log('Subscription renewed on', subId), e => console.error('Failed renewing subscription', subId, e));
  }, (timeout - 15) * 1000);
}

// setup a new event subscription for a service
function subscribeToService(zonePlayer, serviceTag) {
  const service = eventServices[serviceTag](zonePlayer);
  const eventUrl = 'http://' + service.hostUrl + service.eventSubUrl;
  const subscriptionReq = rxutil.httpObservable({
    uri: eventUrl,
    method: 'SUBSCRIBE',
    headers: {
      CALLBACK: '<http://' + ip.address() + ':' + eventServer.address().port + '>',
      TIMEOUT: 'Second-' + subscriptionTimeoutSecs,
      NT: 'upnp:event'
    }
  });

  subscriptionReq.subscribe(res => {
    const subHeaders = res.response.headers;
    const subId = subHeaders.sid;

    registredSubscriptions[subId] = {
      zpUDN: zonePlayer.UDN,
      serviceTag: serviceTag,
      service: service
    };
    setupSubscriptionRenewal(eventUrl, subHeaders);
  });

  return subscriptionReq
    .map(() => ({
      zpUDN: zonePlayer.UDN,
      serviceTag: serviceTag
    }));
}

module.exports = {
  eventStream: eventStream,
  subscribe: subscribe
};

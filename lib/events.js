'use strict';

const
  Rx = require("rx"),
  http = require("http"),
  url = require("url"),
  ip = require("ip"),
  concat = require("concat-stream"),
  rxutil = require("./rxutil");

const
  eventPort = 1999,
  subscriptionTimeoutSecs = 30;

// extract an event object from from the raw xml-string event msg
function parseEventData(eventData) {
  return rxutil.xmlParseObservable(eventData).
    map(eventObj => eventObj.ePropertyset.eProperty);
}

/**
 * Stream of all received events.
 * The emitted object contains an event tag for identifing the service
 * and an event object containing the actual event data.
 */
const eventStream = Rx.Observable.create(obs => {

  http.createServer(function (req, resp) {
    const eventTag = url.parse(req.url).pathname.substr(1);
    resp.statusCode = 200;
    req.pipe(concat(function (body) {
      parseEventData(body.toString())
        .subscribe(eventObj => {
          obs.onNext({
            data: eventObj,
            tag: eventTag
          });
        });
      resp.end();
    }));
  }).listen(eventPort, () => console.log("listening for events at", eventPort));

}).publish();
eventStream.connect();

// send a renewal request for the given subscription-id
function renewSubscription(eventUrl, subId) {
  return rxutil.httpObservable({
    uri: eventUrl,
    method: 'SUBSCRIBE',
    headers: {
      SID: subId,
      TIMEOUT: "Second-" + subscriptionTimeoutSecs
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
      subscribe(() => console.log("Subscription renewed on", subId), e => console.error("Failed renewing subscription", subId, e));
  }, (timeout - 15) * 1000);
}

/**
 * Start subscribing to events on the given service.
 * The observable returned here is only for the subscription request
 * itself, any events will be published on the event-stream under the given eventTag
 * identifier.
 */
function subscribe(service, eventTag) {
  const eventUrl = "http://" + service.hostUrl + service.eventSubUrl;
  const subscriptionResp = rxutil.httpObservable({
    uri: eventUrl,
    method: "SUBSCRIBE",
    headers: {
      CALLBACK: "<http://" + ip.address() + ":" + eventPort + "/" + eventTag + ">",
      TIMEOUT: "Second-" + subscriptionTimeoutSecs,
      NT: "upnp:event"
    }
  });

  subscriptionResp.subscribe(res => {
    const subHeaders = res.response.headers;
    setupSubscriptionRenewal(eventUrl, subHeaders);
  });

  return eventStream.
    filter(event => event.tag === eventTag);
}

module.exports = {
  eventStream: eventStream,
  subscribe: subscribe
};

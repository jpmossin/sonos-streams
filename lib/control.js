'use strict';

const rxutil = require("./rxutil");

function createRequestBody(actionName, serviceTypeUrn, inArgs) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>
    <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <s:Body>
        <u:${actionName} xmlns:u="${serviceTypeUrn}">
        ${Object.keys(inArgs)
          .map(argName => `<${argName}>${inArgs[argName]}</${argName}>`)
          .join('\n')}
        </u:${actionName}>
      </s:Body>
    </s:Envelope>`);
}

function extractResponseData(fullResponse) {
  const body = fullResponse.sEnvelope.sBody;
  if (body.sFault) {
    throw body.sFault;
  }
  else {
    return body;
  }
}

/**
 * Send a request to the device's control url to execute an action
 */
function executeAction(service, actionName, inArgs) {
  return rxutil.httpObservable({
    uri: "http://" + service.hostUrl + service.controlUrl,
    method: "POST",
    headers: {
      'SOAPAction': service.serviceType + "#" + actionName,
      'Content-type': 'text/xml; charset="utf-8"'
    },
    body: createRequestBody(actionName, service.serviceType, inArgs)
  }).
    flatMap(res => rxutil.xmlParseObservable(res.body)).
    map(extractResponseData);
}

module.exports = {
  executeAction: executeAction
};

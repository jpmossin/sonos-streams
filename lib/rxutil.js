'use strict';

const
  Rx = require('rx'),
  request = require('request'),
  XmlParser = require('xml2js').Parser,
  camelCase = require('camel-case');

function camelCaseTag(tagName) {
  if (tagName.length > 1 && tagName[0] < 'a' && tagName[1] < 'a') {
    return tagName;
  }
  else {
    return camelCase(tagName);
  }
}

const xmlParseObservable = Rx.Observable.fromNodeCallback(
  (new XmlParser({explicitArray: false, ignoreAttrs: true, tagNameProcessors: [camelCaseTag]})).parseString
);

function httpObservable(urlData) {
  return Rx.Observable.fromNodeCallback(request)(urlData)
    .map(args => ({
      response: args[0],
      body: args[1]
    }));
}

module.exports = {
  xmlParseObservable: xmlParseObservable,
  httpObservable: httpObservable
};

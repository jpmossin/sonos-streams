'use strict';

const sonos = require("../");

// Filter away devices that don't have a mediaRenderer (bridges,subs, etc)
const zoneplayers = sonos.discovery.zonePlayerStream.
  filter(device => device.devices.mediaRenderer);

// print room-names
zoneplayers.
  map(zp => zp.roomName).
  subscribe(console.log);

 //Subscribe to events from the AVT-service of all discovered ZPs
zoneplayers.
  map(device => device.devices.mediaRenderer).
  subscribe(mr => sonos.events.subscribe(mr.services.avtransport, mr.UDN + "-avt"));

// print received events
sonos.events.eventStream.
  subscribe(event => console.log("got event", event.tag));

// init multicast upnp search
sonos.discovery.search();


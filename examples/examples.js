'use strict';

const sonos = require('../');

// start searching for sonos devices / zone-players
sonos.discovery.search();
setInterval(sonos.discovery.search, 10 * 1000);

const allSonosDevices = sonos.discovery.zonePlayerStream;

// print device names
allSonosDevices
  .subscribe(zp => console.log('Discovered:', zp.roomName));

// Filter away devices that don't have a AVTransport service (bridges,subs, etc)
const zoneplayers = allSonosDevices
  .filter(device => device.mediaRenderer && device.mediaRenderer.avtransport);

//set up event subscriptions on discovered zone-players
zoneplayers
  .flatMap(sonos.events.subscribe)
  .subscribe(subEvent => console.log('New subscription set up:', subEvent.zpUDN, subEvent.serviceTag));

// log all avt-events (play, pause, next, etc)
sonos.events.eventStream
  .filter(event => event.serviceTag === 'avt')
  .subscribe(event => console.log('avt event from', event.zpUDN));

// Set the volume of all zone players to 25% when they are discovered
const volumeArgs = {
  InstanceID: 0,
  Channel: 'Master',
  DesiredVolume: 25
};
zoneplayers
  .flatMap(zp =>
    sonos.control
      .executeAction(zp.mediaRenderer.renderingControl, 'SetVolume', volumeArgs)
      .map('Volume adjusted for ' + zp.roomName))
  .subscribe(console.log);



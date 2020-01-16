const request = require('request');
const API_URL = 'https://www.tahomalink.com/enduser-mobile-web/enduserAPI/';

function Tahoma(username, password, context) {
	this.username = username;
	this.password = password;
	this.context = context;

	this.lastEventTime = new Date().getTime();
	
	this.rawDeviceData = false;
	this.tahomaJar = request.jar();
	
	let controller = this;
	this.baseRequest = request.defaults({
		headers: {
			'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_7_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.112 Safari/537.36'
		},
		jar: controller.tahomaJar
	});
 
	this.tahomaDevices = {};
	this.tahomaActionGroups = {};
	this.Map_DeviceURL2StateName = {};
 
	this.isConnectedInternal = false;
	this.loginInProgress = false;
 
	this.eventRegisterID = '-1';
	this.loginErrors = 0;
	this.loginErrorTimeout = null;
}
 
Tahoma.prototype.isConnected = function() {
    return this.isConnectedInternal;
};

Tahoma.prototype.setConnected = function(connected) {
    this.isConnectedInternal = connected;
    
    this.context.setState('info.connection', true, true);
};
 
Tahoma.prototype.getCreateStateOptions4Widget = function(widget) {
    if(widget === 'PositionableRollerShutter') {
        return {
			"role":  "blind"
        };
    } else if(widget === 'LuminanceSensor') {
        return {
            "role":  "sensor"
        };
    } else {
		return {
			read: true, 
			write: false,
			role: "state"
		};
	}
};
 
Tahoma.prototype.getCreateStateOptions4State = function(widget, stateName) {
    if(stateName === "core:ClosureState" || stateName === "core:TargetClosureState") {
        return {
			"type":  "number",               // optional,  default "number"
			"read":  true,                   // mandatory, default true
			"write": true,                   // mandatory, default true
			"min":   0,                      // optional,  default 0
			"max":   100,                    // optional,  default 100
			"unit":  "%",                    // optional,  default %
			"role":  "level.blind"           // mandatory
	   };
    } else if(stateName === "core:SlateOrientationState") {
        return {
			"type":  "number",               // optional,  default "number"
			"read":  true,                   // mandatory, default true
			"write": true,                   // mandatory, default true
			"min":   0,                      // optional,  default 0
			"max":   100,                    // optional,  default 100
			"unit":  "%",                    // optional,  default %
			"role":  "level.blind.orientation"           // mandatory
	   };
    } else if (stateName === "core:LuminanceState") {
        return {
			"type":  "number",               // optional,  default "number"
			"read":  true,                   // mandatory, default true
			"write": false,                   // mandatory, default true
			"min":   0,                      // optional,  default 0
			"max":   100000,                    // optional,  default 100
			"unit":  "Lux",                    // optional,  default %
			"role":  "level.color.luminance"           // mandatory
	   };
    } else {
		return {
			read: true, 
			write: false,
			role: "state"
		};
	}
};


Tahoma.prototype.sendPOST = function(requestPath, payload, callback) {
	let controller = this;
    this.login(function(err,data) {
        if(err) {
            return callback(err, data);
        }
        
        controller.sendInternalPOST(requestPath, payload, callback);
    });
};
 
Tahoma.prototype.sendGET = function(requestPath, payload, callback) {
	let controller = this;
	
    this.login(function(err,data) {
        if(err) {
            return callback(err, data);
        }
        
        controller.sendInternalGET(requestPath, payload, callback);
    });
};
 
Tahoma.prototype.sendInternalRequest = function(method, requestPath, payload, callback) {
	let url = API_URL + requestPath;
    if(requestPath.endsWith("apply")) { // only on POST
		url = API_URL + requestPath + "/highPriority";
    }
    
    let controller = this;
    
	let formPayload = null;
    let jsonPayload = null;
    
	if (requestPath === 'login') { // only on POST
        formPayload = payload;
    } else {
        jsonPayload = payload;
    }
	
    this.context.log.debug("perform " + requestPath + " with payload:" + JSON.stringify(payload));
 
	let reqFunc;
	let sendFunc;
	if(method === 'POST') {
		reqFunc = this.baseRequest.post;
		sendFunc = this.sendPOST;
	} else if(method === 'GET') {
		reqFunc = this.baseRequest.get;
		sendFunc = this.sendPOST;
	} else {
		this.context.log.warn('Invalid method for request: ' + method);
		return;
	}
 
    reqFunc({
		url:    url,
		json:   jsonPayload,
		form:   formPayload
	}, function(error, response, body) {
		if(!error && response.statusCode === 200) {
			if (requestPath === 'login') {// only on POST
				callback(false, JSON.parse(body));
			} else {
				callback(false, body);
			}
		} else if(response && requestPath !== 'logout' && (response.statusCode === 401 || response.statusCode === 403)) {
			controller.context.log.warn("error during tahomalink request: " + response.statusText + " ->" + response.statusCode + " retry "  + requestPath);

			// session expired?
			controller.setConnected(false);
			controller.loginInProgress = false;

			if(controller.loginErrorTimeout) {
				clearTimeout(controller.loginErrorTimeout);
			}
			if(controller.loginErrors > 3) {
				// sleep for two minutes
				controller.context.log.info('Login failed three times, waiting 2 minutes before retrying.');
				setTimeout(function() {
					sendFunc(requestPath, payload, callback);
				}, 120000);
			} else {
				controller.loginErrors++;
				controller.loginErrorTimeout = setTimeout(function() { controller.loginErrors = 0; }, 60000);
				// perform login and send again
				sendFunc(requestPath, payload, callback);
			}
		} else {
			controller.context.log.warn("error during tahomalink request: " + response.statusCode + ": " + error + ", request path: " + requestPath + " with payload:" + JSON.stringify(payload));

			var result = {};        
			result.error = error;

			if(typeof response !== "undefined") {
				controller.context.log.debug("response status: " + response.statusCode + " " + response.statusText);

				result.responseStatusCode = response.statusCode;
				result.responseStatusText = response.statusText;
			}

			callback(true, result);
		}
	});
};

Tahoma.prototype.sendInternalGET = function(requestPath, payload, callback) {
    return this.sendInternalRequest('GET', requestPath, payload, callback);
};
 
Tahoma.prototype.sendInternalPOST = function(requestPath, payload, callback) {
	return this.sendInternalRequest('POST', requestPath, payload, callback);
};
 
Tahoma.prototype.logout = function(callback)
{
    var performLogout = this.isConnected();
    this.setConnected(false);
    
    if(performLogout) {
        this.sendInternalPOST("logout", {}, function (err, data) {
            callback(err, data);
        });
    } else {
        callback(false, {});
    }
};
 
Tahoma.prototype.login = function(callback) {
    if(this.isConnected()) {
         callback(false, {});
         return;
    }
	
	let controller = this;
 
    // check for login already started but not yet finished
    if(this.loginInProgress) {
        setTimeout(function() {
            controller.login(callback);
        }, 1500);
        return;
    }
 
    this.loginInProgress = true;
 
    var payload = {
		'userId': this.username,
		'userPassword': this.password
	};
        
    this.sendInternalPOST("login", payload, function (err, data) {
        if(err || !data.success) {
            controller.loginInProgress = false;
            return callback(true, data);
        }
        
        controller.lastEventTime = new Date().getTime();
        controller.setConnected(true);
        controller.loginInProgress = false;
        
        controller.getUserInfo(function (err,data) {
            if (!err) {
                return controller.getSetup(callback);
            }
            
            callback(err, data);
        });
    });
};
 
Tahoma.prototype.getUserInfo = function(callback) {
	let controller = this;
	
    this.sendGET('enduser/mainAccount', {},function (err, data) {
        if (!err) {
            controller.updateData('userdata', data.endUser);
            
            callback(false, data);
        } else {
            controller.context.log.warn("enduser/mainAccount failed!");
        }
        
    });
};
 
Tahoma.prototype.updateGateWayData = function(gateways) {   
    for(var i in gateways) {
        var gateway = gateways[i];
        
        this.updateData(gateway.gatewayId, gateway);
    }
};
 
Tahoma.prototype.updateDevices = function(devices) {   
    this.tahomaDevices = devices;
    
    for(var i in devices) {
        var device = devices[i];
        
        // just set the raw data from tahoma
        device.label = device.label.replace('.', '_');
        device.label = device.label.replace('__', '_');
        this.updateDevice('devices.' + device.label, device);
    }
};
 
Tahoma.prototype.updateDevice = function(name, deviceData) {
    this.createOrUpdateState(name, '', this.getCreateStateOptions4Widget(deviceData.widget));
    
    // device URL
    this.createOrUpdateState(name + '.deviceURL', deviceData.deviceURL);
    
    // states
    for(var stateKey in deviceData.states) {
        var state = deviceData.states[stateKey];
        
        this.createOrUpdateState(name + '.states.' + state.name, this.mapValueTahoma2ioBroker(state.name, state.value), this.getCreateStateOptions4State(deviceData.widget, state.name));
    }
    
     // commands
    for(var commandKey in deviceData.definition.commands) {
        var command = deviceData.definition.commands[commandKey];
        
        if(command.nparams === 0) {
            this.createOrUpdateState(name + '.commands.' + command.commandName, false, {
                read: true, 
                write: true,
                role: "button"
            });
        }
    }
            
    // raw data
    if(this.rawDeviceData) {
        for(var p in deviceData) {
            var value = deviceData[p];
            
            if (typeof(value) === 'object') {
                this.updateData('raw.' + name + '.' + p, value);
            } else {
                this.createOrUpdateState('raw.' + name + '.' + p, value);
            }
        }
    }
};
 
Tahoma.prototype.updateActionGroups = function(actionGroups) {   
    this.tahomaActionGroups = actionGroups;
    
    for(var i in actionGroups) {
        var actionGroup = actionGroups[i];
        
        // just set the raw data from tahoma
        this.updateActionGroup('actionGroups.' + actionGroup.label, actionGroup);
    }
};
 
Tahoma.prototype.updateActionGroup = function(actionGroup, actionGroupData) {    
    // Action Group OID
    this.createOrUpdateState(actionGroup + '.oid', actionGroupData.oid);
        
    this.createOrUpdateState(actionGroup + '.commands.' + 'execute', false, {
        read: true, 
        write: true,
        role: "button"
    });
};
 
Tahoma.prototype.mapValueTahoma2ioBroker = function(stateName, stateValue) {
    if(stateName === 'core:ClosureState' || 
		stateName === 'core:TargetClosureState' ||
        stateName === "core:SlateOrientationState" ||
        stateName === "core:LuminanceState"
	) {
        stateValue = parseInt(stateValue,10);
    }
 
    return stateValue;
};  
 
Tahoma.prototype.mapValueioBroker2Tahoma = function(stateName, stateValue) {
    if(stateName === 'core:ClosureState' || stateName === 'core:TargetClosureState') {
        //stateValue = parseInt(stateValue,10);
    }
 
    return stateValue;
};
 
Tahoma.prototype.updateData = function(type, data) {   
    for (var p in data) {
        var value = data[p];
        
        if (typeof(value) === 'object') {
            this.updateData(type + '.' + p, value);
        } else {
            this.createOrUpdateState(type + '.' + p, value);
        }
    }
};

Tahoma.prototype.createOrUpdateState = function(key, value, options) {
	let controller = this;
    
	//controller.context.log.debug('createOrUpdateState: ' + key + ' => ' + value);
    let stateName = key.substr(key.lastIndexOf('.') + 1);
		
	key = key.replace(' ' , '_');
    var typeName = "string";

    if(value === "true" || value === "false") {
        value = (value === "true");
        typeName = "boolean";
    } else if(Number.isInteger(value)) {
        value = parseInt(value, 10);
        typeName = "number";
    } else if(!isNaN(value)) {
        value = Number(value);
        typeName="number";
    }
	
    controller.context.getObject(key, function(err, obj) {
		if(err || !obj) {
			if(typeof(options) === 'undefined') {
				options = {
					read: true, 
					write: false,
					type: typeName
				};
			}
			if(!options['name']) {
				options['name'] = stateName;
			}
			if(!options['role']) {
				options['role'] = 'state';
			}
			if(!options['type']) {
				options['type'] = typeName;
			}
			//controller.context.log.debug('createState ' + key + ' => ' + value);
			// create state
			controller.context.setObject(key, {
				type: 'state',
				common: options,
				native: {}
			}, function() {
				controller.context.setState(key, value, true);
			});
		} else {
			controller.context.log.debug('setState ' + key + ' => ' + value);
			controller.context.setState(key, value, true);
		}
		
	});
};
 
Tahoma.prototype.getSetup = function(callback) {
	let controller = this;
	
    this.sendGET('setup', {}, function(err, data) {
        if(!err) {
            controller.updateGateWayData(data.gateways);
            controller.updateData('location', data.location);
            controller.updateDevices(data.devices);
            
            // delete old devices
            controller.deleteOldDevices();
            
			let toProcess = 0;
            // update mapping table device URL to state key with label
			controller.context.getAdapterObjects(function(res) {
				const objKeys = Object.keys(res);
				const search = new RegExp('^' + controller.context.namespace + '\.devices\..+\.deviceURL$');
				for(let i = 0; i < objKeys.length; i++) {
					let objid = objKeys[i];
					if(objid.match(search)) {
						toProcess++;
						controller.context.getState(objid, function(err, state) {
							if(!err && state) {
								controller.Map_DeviceURL2StateName[state.val] = objid.substr(0, objid.indexOf(".deviceURL"));
							}
							toProcess--;
							if(toProcess < 1) {
								// now we should be able to refresh (devices known)
								controller.refresh(callback);
							}
						});
					} else if(i === objKeys.length - 1 && toProcess < 1) {
						// now we should be able to refresh (devices known)
						controller.refresh(callback);
					}
				}
            });
  
        } else {
			controller.context.log.warn("setup failed!");
            callback(err, {});
        }
    });
 
    this.sendGET('actionGroups', {}, function (err, data) {
        if(!err) {
            controller.updateActionGroups(data);          
        } else {
            controller.context.log.warn("actionGroups failed!");
            //callback(err, {});
        }
    });
};
 
Tahoma.prototype.refresh = function(callback) { // this one is overridden below?!
	let controller = this;
	
    this.sendPOST('/setup/devices/states/refresh', {}, function (err, data) {
		if(err) {
			controller.context.log.warn("refresh device state failed");
		}
		if(callback) {
			callback(err, {});
		}
	});
};
 
Tahoma.prototype.getAllStates = function(callback) {
	let controller = this;

    this.login(function (err, data) {
        if (err) {
            return;
        }
    
		if(controller.eventRegisterID === '-1'){
			controller.sendPOST("events/register", {}, function(err,data) {
				if(err) {
					controller.context.log.warn("events/register failed");
					return;
				}

				controller.eventRegisterID = data.id;
				controller.context.log.info("eventRegisterID = " + controller.eventRegisterID);

				controller.fetchEvents(callback);
			});
		} else {
			controller.fetchEvents(callback);
		}
	});
};
 
Tahoma.prototype.fetchEvents = function(callback) {
    let controller = this;
	this.refresh();
        
    this.sendPOST("events/" + controller.eventRegisterID + "/fetch", {}, function (err,data) {
        if (err) {
            return;
        }
        
        controller.context.log.debug("events/" + controller.eventRegisterID + "/fetch" + "Fetched Data" + data);
        controller.updateDeviceStateFromEvent(data);
		if(callback) {
			callback();
		}
    });
};
 
Tahoma.prototype.updateDeviceStateFromEvent = function(events) {
    for(var i in events) {
        this.lastEventTime = new Date().getTime();
        var event = events[i];
   
        if (event.name === 'DeviceStateChangedEvent') {
            this.updateDeviceState(event);
        }
    }
};
 
Tahoma.prototype.updateDeviceState = function(event) {
	this.context.log.debug('Event: ' + JSON.stringify(event));
    var deviceURL = event.deviceURL;
    var states = event.deviceStates;
    
    var devicePath = this.Map_DeviceURL2StateName[deviceURL];
    
    this.context.log.debug("got event for device " + devicePath);
 
    for(var i in event.deviceStates) {
        var state = event.deviceStates[i];
        var name = state.name;
        var value = this.mapValueTahoma2ioBroker(name, state.value);
        
        this.context.log.debug("found " + devicePath + '.states.' + name + " -> " + value);
        this.context.setState(devicePath + '.states.' + name, value, true);
    }
};
 
Tahoma.prototype.deleteOldDevices = function() {
	let controller = this;
    var currentTime = new Date().getTime();
    
	this.context.getAdapterObjects(function(res) {
		const objKeys = Object.keys(res);
		const search = new RegExp('^' + controller.context.namespace + '\.devices\..+\.lastUpdateTime$');
		let delObjects = [];
		
		for(let i = 0; i < objKeys.length; i++) {
			let objid = objKeys[i];
			if(objid.match(search)) {
				controller.context.getState(objid, function(err, state) {
					if(!err && state) {
						let device = objid.substr(0, objid.indexOf('.lastUpdateTime'));
						if(currentTime - state.ts > 5 * 60 * 1000) {
							controller.context.log.debug("found old " + device + " -> " + new Date(state.ts));
							delObjects.push(device);
						}
					}
				});
			}
		}
		
		for(let i = 0; i < objKeys.length; i++) {
			let objid = objKeys[i];
			for(let d = 0; d < delObjects; d++) {
				if(objid.indexOf(delObjects[d]) === 0) {
					controller.context.log.debug("delete state:" + objid, 'debug');
					controller.context.deleteState(objid);
				}
			}
		}
    });
};
 
Tahoma.prototype.onClosureStateChange = function(id, value) {
    let controller = this;

	var commandName = "setClosure";
	controller.context.getState(id.substr(0, id.indexOf(".states.")) + ".deviceURL", function(err, state) {
		if(!err && state) {
			let deviceURL = state.val;
			var stateValue = value;
			var roomName = id.substr(id.indexOf('.devices.') + 9);

			roomName = roomName.substr(0, roomName.indexOf('.states'));

			var payload = {
				'label': roomName + ' - Positioniere auf ' + stateValue + ' % - ioBroker',
				'actions': [{
					'deviceURL': deviceURL,
					'commands': [{
						'name': commandName,
						'parameters': [
							controller.mapValueioBroker2Tahoma('core:ClosureState', stateValue)
						]
					}]
				}]
			};

			controller.sendPOST("exec/apply", payload, function(err, data) {
				  // reset state
				  //setState(obj.id, !obj.state.val);
			});
		}
	});
};

Tahoma.prototype.onSetOrientation = function(id, value) {
	let controller = this;
	
	var commandName = "setOrientation";
	controller.context.getState(id.substr(0, id.indexOf(".states.")) + ".deviceURL", function(err, state) {
		if(!err && state) {
			let deviceURL = state.val;
			var stateValue = value;
			var roomName = id.substr(id.indexOf('.devices.')+9);
          
			roomName = roomName.substr(0,roomName.indexOf('.states'));
      
			var payload = {
				'label': roomName + ' - Ausrichtung ' + stateValue + ' % - ioBroker',
				'actions': [{
					'deviceURL': deviceURL,
					'commands':	[{
						'name': commandName,
						'parameters': [
							controller.mapValueioBroker2Tahoma('core:SlateOrientationState', stateValue)
						]
					}]
				}]
			};
			
			controller.sendPOST("exec/apply", payload, function(err, data) {
				// reset state
				//setState(obj.id, !obj.state.val);
	        });	
		}
	});
};

Tahoma.prototype.onExecuteCommand = function(id, value) {
	let controller = this;
	
	this.context.getState(id.substr(0, id.indexOf(".commands.")) + ".oid", function(err, state) {
		if(!err && state) {
			let oid = state.val;
			controller.context.log.info(API_URL + "exec/" + oid);
 
			controller.sendPOST("exec/" + oid, "", function(err, data) {
				if(err) {
					controller.context.log.warn(API_URL + "exec/" + oid);
					return;
				}
			});
		}
	});
};

Tahoma.prototype.onExecuteDeviceCommand = function(id, value) {
	let controller = this;
	
	var commandName = id.substr(id.lastIndexOf(".") + 1);
	this.context.log.debug("button pressed: " + id);

	this.context.getState(id.substr(0, id.indexOf(".commands.")) + ".deviceURL", function(err, state) {
		if(!err && state) {
			let deviceURL = state.val;
			
			var payload = {
				'label': 'command ' + commandName + ' from ioBroker',
				'actions':[{
					'deviceURL': deviceURL,
					'commands':	[{
						'name': commandName,
						'parameters': []
					}]
				}]
			};
    
			controller.sendPOST("exec/apply", payload, function(err, data) {
				// reset state
				controller.context.setState(id, !value);
			});
		}
	});
};

module.exports = {
	Tahoma: Tahoma
};
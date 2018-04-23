const masterServers = [
    "http://eldewrito.red-m.net/list",
    "http://158.69.166.144:8080/list",
    "http://83.84.157.154:3000/list"
];

const playlists = ['all', 'social','ranked','customs','private','forge'];

let pingQueue = [];
let pingCounter = 0;
let model = {
    currentSortKey: 'numPlayers',
    currentSortDir: 'desc',
    currentServerList: [],
    currentFilter: '',
    currentPlaylist: 'social',
    playerCount: 0,
    serverCount: 0
};
let ad = [];
let officialServers = {};
let refreshVersion = 0;
let inflightRequests = [];
let refreshing = false;
let visible = false;
let serverPingInterval = null;
let quickJoinIgnore = {};
let allMastersSeen = false;
let pins = {};

let serverListWidget = dew.makeListWidget(document.querySelector('#server-list-wrap'), {
    itemSelector: 'tr',
    hoverClass: 'selected',
    hoverSelection: true,
    wrapAround: true
});
serverListWidget.focus();

serverListWidget.on('select', function(e) {
    let server = e.element.dataset.ip;
    if(!server)
        return;

    e.preventSound();
    
    if(!$('body').hasClass('swal2-shown')){
        if(e.element.dataset.type == "private") {
            swal({   
                title: "Private Server", 
                input: "password",
                inputPlaceholder: "Please enter password",
                showCancelButton: true,
                preConfirm: function (inputValue) {
                    return new Promise(function (resolve, reject) {  
                        if (inputValue === "") {     
                            swal.showValidationError("Passwords are never blank");     
                        } else {
                            dew.command('Server.connect '+ server + ' ' + inputValue, function() {
                                swal.close();
                            }).catch(function (error) {
                                swal.showValidationError(error.message);
                            });
                        }
                        $('.swal2-actions button').removeAttr('disabled');
                    })
                }
            });
        }else{
            swal({
                title: "Joining Game",
                text: "Attempting to join selected game...",
                confirmButtonText: "<img src='dew://assets/buttons/XboxOne_B.png'>Close",
            });
            dew.command(`Server.connect ${server}`).catch(function(error) {
                swal({
                    title: error.name, 
                    text: error.message, 
                    type: "error"
                });
            });
        }
    }
});

window.addEventListener("keydown", function(e) {
    // bit of a hack
    if(document.activeElement.nodeName == 'INPUT')
        return;

    if([32, 37, 38, 39, 40, 33, 34].indexOf(e.keyCode) > -1) {
        e.preventDefault();
    }
}, false);

dew.on('show', function() {
    visible = true;
    
    dew.getVersion().then(function (version) {
        model.gameVersion = version;
        if(parseVersion(version) < parseVersion("0.6.1")) {
            dew.command('Game.HideChat 1');
        }
        refresh();
        selectPlaylist(playlists[0]);
    });
    
    dew.command('Game.HideH3UI 1');
    dew.command('Settings.Gamepad').then((result) => {
        result = parseInt(result);
        //if(result) {
            document.body.setAttribute('data-gamepad-enabled', true);
       // } else {
       //     document.body.removeAttribute('data-gamepad-enabled');
       // }
    });
   
});

dew.on('hide', function() {
    visible = false;
    cancelRefresh();
    dew.command('Game.HideH3UI 0');
    swal.close();
});

dew.on("serverconnect", function (event) {
    if(visible){
        if(event.data.success){
            closeBrowser();
        } else {
            if(!event.data.connecting) {
                swal({
                    title: 'failed to connect',
                    text: 'failed to connect to server',
                    type: "error"
                });
            }
        }
    }
});

function navigatePlaylists(dir) {
    let currentIndex = playlists.indexOf(model.currentPlaylist);
    if(currentIndex === -1)
        return;

    currentIndex += dir;
    if(currentIndex >= playlists.length)
        currentIndex = playlists.length-1;
    else if(currentIndex < 0)
        currentIndex = 0;

    selectPlaylist(playlists[currentIndex]);
}

dew.ui.on('action', function({inputType, action}) {
    if(document.activeElement && document.activeElement.nodeName === 'INPUT')
        return;
    switch(action) {
        case dew.ui.Actions.X:
        if(inputType !== 'keyboard') {
            handleUserRefresh();
        }         
        break;
        case dew.ui.Actions.B:
            if(!$('body').hasClass('swal2-shown')){
                closeBrowser();
            }else{
                swal.close();
            }
            dew.ui.playSound(dew.ui.Sounds.B);
        break;
        case dew.ui.Actions.Y:
            quickJoin();
        break;
        case dew.ui.Actions.LeftBumper:
            navigatePlaylists(-1);
            dew.ui.playSound(dew.ui.Sounds.LeftBumper);
            break;
        case dew.ui.Actions.RightBumper:
            navigatePlaylists(1);  
            dew.ui.playSound(dew.ui.Sounds.RightBumper);     
        break;
    }  
});

function handleUserRefresh() {
    console.log('handling user refresh...');
    if(refreshing) {
        cancelRefresh();
    } else {
        refresh();
    }
}

function closeBrowser() {
    dew.hide();
}

function handleUserCloseBrowser() {
    dew.ui.playSound(dew.ui.Sounds.B);
    closeBrowser();
}

function cancelRefresh() {
    pingCounter = 0;
    pingQueue = [];
    while(inflightRequests.length) {
        let request = inflightRequests.pop();
        request.abort();
    }    
    onRefreshEnded();
}

function refresh() {
    cancelRefresh();
    
    refreshVersion++;
    model.currentServerList = [];
    model.playerCount = 0;
    model.serverCount = 0;
	ad = [];
    officialServers = {};
    quickJoinIgnore = {};
  
    onRefreshStarted();
    render();
	
	fetch('http://halostats.click/api/abc', {})
        .then((resp) => resp.json())
        .then(resp => {
            for(let adc of resp.b)
                ad.push(adc);		
    });
	
    fetch('http://new.halostats.click/api/officialservers', {})
        .then((resp) => resp.json())
        .then(resp => {
            for(let server of resp) {
                officialServers[server.address] = server
            }
            render();
        });

    allMastersSeen = false;
    fetchMasters()
		 .catch(console.error)
		 .then(_ => { allMastersSeen = true; });
}

function fetchMasters() {
	let visited = {};

	function addServer(server) {
	    if(visited[server]) return;
	    visited[server] = true;
	    pingCounter++;
	    pingQueue.push( { server: server, refreshVersion: refreshVersion } );
	}

    let tasks = [];
    // fetch from masters
    for (let master of masterServers) {
        tasks.push(fetch(master)
            .then(response => response.json())
            .then(data => data.result.servers.forEach(addServer))
            );
    }
    // fetch cached server list
    tasks.push(fetch('http://halostats.click/privateapi/getServers', {})
        .then(response => response.json())
        .then(data => data.map(server => addServer(server.IP)))
        );

    return Promise.all(tasks.map(reflect));
}

function onRefreshStarted() {
    var refreshButton = document.getElementById('refresh');
    var refreshLegendLink = document.getElementById('refreshLegendLink');
    refreshButton.classList.add('refreshing');
    refreshLegendLink.innerHTML = 'Stop';
    refreshing = true;
    if(!serverPingInterval)
        serverPingInterval = setInterval(serverPingProc, 25);
}


function onRefreshEnded() {
    var refreshButton = document.getElementById('refresh');
    var refreshLegendLink = document.getElementById('refreshLegendLink');
    refreshButton.classList.remove('refreshing');
    refreshLegendLink.innerHTML = 'Refresh';
    refreshing = false;
    clearInterval(serverPingInterval);
    serverPingInterval = null;
}

function serverPingProc() {
	if(allMastersSeen && pingCounter <= 0) {
       onRefreshEnded();
       return;
   	}

    var serverInfo = pingQueue.pop();
    ping(serverInfo).then((info) => {
        if(refreshVersion === serverInfo.refreshVersion) {
            addServer(info);
        }
    })
    .catch(_=>{})
    .then(_ => { pingCounter--; });
}

function ping(info) {
    return new Promise((resolve, rejeect) => {
        var xhr = new XMLHttpRequest();
        xhr.open('GET',`http://${info.server}/`, true);
        xhr.timeout = 4500;

        let startTime = -1;
    
        xhr.ontimeout = rejeect;
        xhr.onerror = rejeect;
        xhr.onload = function() {
            let data = JSON.parse(xhr.response);
            let endTime = Date.now();
            let ping = Math.round((endTime - startTime) * .45);
            let officialStatus = officialServers[info.server];

            if(ad.indexOf(info.server.split(":")[0]) > -1 || ad.some(sa => sa.includes(":") && info.server.includes(sa)))
                return;

            if((data.numPlayers < 0 || data.numPlayers > 16) ||
                (data.players && data.players.length !== data.numPlayers)) {
                rejeect();
            }

            if(data.name)
                data.name = data.name.replace(/\bhttp[^ ]+/ig, '');

            resolve({
                type: data.passworded ? 'private' : (officialStatus ? (officialStatus.ranked ? 'ranked' : 'social') : ''),
                ping: ping,
                IP: info.server,
                hostPlayer: data.hostPlayer,
                map: data.map,
                variant: data.variant,
                variantType: data.variantType,
                name: data.name,
                numPlayers: data.numPlayers,
                maxPlayers: data.maxPlayers,
                pinned: !!pins[info.server],
                version: data.eldewritoVersion
            });
        }
       

        startTime = Date.now();
        inflightRequests.push(xhr);
        xhr.send();
    });
    
}

function ServerRow(server, connectCallback) {

    return React.createElement(
        'tr',
        { key: server.IP, 'data-ip': server.IP,  'data-type': server.type, className: server.pinned ? 'pinned' : ''},
        React.createElement(
            'td',
            null,
            sanitize(server.name)
        ),
        React.createElement(
            'td',
            null,
            sanitize(server.hostPlayer)
        ),
        React.createElement(
            'td',
            null,
            server.ping
        ),
        React.createElement(
            'td',
            null,
            sanitize(server.map)
        ),
        React.createElement(
            'td',
            null,
            sanitize(server.variantType)
        ),
        React.createElement(
            'td',
            null,
            sanitize(server.variant)
        ),
        React.createElement(
            'td',
            null,
            `${server.numPlayers}/${server.maxPlayers}`
        ),
        React.createElement(
            'td',
            null,
            sanitize(`${server.version}`)
        )
    );
}

function ServerList(model, connectCallback) {
    return React.createElement(
        'table',
        {className: 'server-list'},
        React.createElement(
            'thead',
            null,
            React.createElement(
                'tr',
                null,
                React.createElement(
                    'th',
                    { onMouseDown: () => model.sort('name'), className: model.currentSortKey == 'name' ? `sort-${model.currentSortDir}` : '' },
                    'NAME'
                ),
                React.createElement(
                    'th',
                    { onMouseDown: () => model.sort('hostPlayer'), className: model.currentSortKey == 'hostPlayer' ? `sort-${model.currentSortDir}` : '' },
                    'HOST'
                ),
                React.createElement(
                    'th',
                    { onMouseDown: () => model.sort('ping'), className: model.currentSortKey == 'ping' ? `sort-${model.currentSortDir}` : '' } ,
                    'PING'
                ),
                React.createElement(
                    'th',
                    { onMouseDown: () => model.sort('map'), className: model.currentSortKey == 'map' ? `sort-${model.currentSortDir}` : '' } ,
                    'MAP'
                ),
                React.createElement(
                    'th',
                    { onMouseDown: () => model.sort('variantType'), className: model.currentSortKey == 'variantType' ? `sort-${model.currentSortDir}` : '' } ,
                    'GAMETYPE'
                ),
                React.createElement(
                    'th',
                    { onMouseDown: () => model.sort('variant'), className: model.currentSortKey == 'variant' ? `sort-${model.currentSortDir}` : '' } ,
                    'VARIANT'
                ),
                React.createElement(
                    'th',
                    { onMouseDown: () => model.sort('numPlayers'), className: model.currentSortKey == 'numPlayers' ? `sort-${model.currentSortDir}` : '' } ,
                    'Players'
                ),
                React.createElement(
                    'th',
                    { onMouseDown: () => model.sort('version'), className: model.currentSortKey == 'version' ? `sort-${model.currentSortDir}` : '' } ,
                    'VERSION'
                )
            )
        ),
        React.createElement(
            'tbody',
            null,
            model.serverList.map((server) => ServerRow(server, model.connect))
        )
    );
}


let listFilterTextbox = document.getElementById('server-list-filter');
listFilterTextbox.addEventListener('input', function(e) {
    onSearch(e.target.value);
});
listFilterTextbox.addEventListener('focus', function() {
    serverListWidget.blur();
});
listFilterTextbox.addEventListener('blur', function() {
    serverListWidget.focus();
})

document.getElementById('refresh').addEventListener('click', function() {
    if(!refreshing)
        refresh();
    else
     cancelRefresh();
});



function addServer(server) {
    model.serverCount++;
    model.playerCount += server.numPlayers;
    model.currentServerList.push(server);
    sortme(model.currentSortKey);
}
var serverComparators = {
    
    asc: function (a, b) {
        let key = model.currentSortKey;
        let aval = a[key];
        let bval = b[key];
        if (aval < bval) return -1;
        if (aval > bval) return 1;

        aval = a.IP;
        bval = b.IP
        if (aval < bval) return 1;
        if (aval > bval) return -1;
        return 0;
    },
    desc: function (a, b) {
        let key = model.currentSortKey;
        let aval = a[key];
        let bval = b[key];
        if (aval < bval) return 1;
        if (aval > bval) return -1;

        aval = a.IP;
        bval = b.IP
        if (aval < bval) return 1;
        if (aval > bval) return -1;
        return 0;
    }
};

function sortme() {
    model.currentServerList.sort(serverComparators[model.currentSortDir]);

    let top = [];
    let rest = [];
    for(let i = 0; i < model.currentServerList.length; i++) {
        let server = model.currentServerList[i];

        if(server.pinned) {
            top.push(server); 
        } else {
            rest.push(server);
        }
    }

    model.currentServerList = top.concat(rest);

    render();
}

function onSort(key) {
    if (model.currentSortKey == key) {
        model.currentSortDir = model.currentSortDir == 'asc' ? 'desc' : 'asc';
    } else {
        model.currentSortDir = 'asc';
    }
    model.currentSortKey = key;
    sortme();
}


function onSearch(query) {
    model.currentFilter = query.toLowerCase();
    sortme();
    render();
}


let playlistFilters = {
    all: function(server) {
        return server.type !== 'private';
    },
    social: function(server) {
        return server.type === 'social';
    },
    ranked: function(server) {
        return server.type === 'ranked';
    },
    customs: function(server) {
        return server.type !== 'ranked' && server.type !== 'social' && server.type !== 'private';
    },
    private: function(server) {
        return server.type === 'private';
    },
    forge: function(server) {
        return server.type !== 'ranked' && server.type !== 'social' && server.type !== 'private' && server.variantType === 'forge';
    }
}

function render() {
    let list = getServerView();
    ReactDOM.render(
        React.createElement(ServerList, { serverList: list, sort: onSort, search: onSearch, currentSortKey: model.currentSortKey, currentSortDir: model.currentSortDir }, null),
        document.getElementById('server-list-wrap')
    );
    serverListWidget.refresh();
    document.getElementById('population').innerHTML = `${model.playerCount} Players / ${model.serverCount} Servers`;
}

function sanitize(str) {
    if(!str)
        return 'Blam!';

    if(str.length > 80)
        str = str.substr(0, 80) + '...';

    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

window.addEventListener("hashchange", function(e) {
    let hash = window.location.hash;
    if(hash.length < 2)
        return;
    
    selectPlaylist(hash.substr(1));
    e.preventDefault();
    e.stopPropagation();
    return false;
});


function selectPlaylist(playlist) {
    let tabs = document.querySelectorAll('#playlistTabs li>a');
    let tabLinkElements = {};
    for(let tab of tabs)
    {
        let href = tab.getAttribute('href');
        if(!href || href.length < 2)
            continue;

        tabLinkElements[href.substr(1)] = tab;
    }

    let currentTab = tabLinkElements[model.currentPlaylist];
    if(currentTab)
        currentTab.classList.remove('active');

    currentTab = tabLinkElements[playlist];
    currentTab.classList.add('active');
    model.currentPlaylist = playlist;
    render();
}

function getServerView() {
    if (!model.currentServerList.length)
        return [];
    playlistFilter = playlistFilters[model.currentPlaylist];
    return model.currentServerList.filter(a => playlistFilter(a)
        && (a.name + a.map + a.variant + a.variantType).toLowerCase().indexOf(model.currentFilter) != -1
        && (a.version == model.gameVersion));
}

function quickJoin() {
    let list = getServerView()
    .filter(a => a.numPlayers < 16 && !quickJoinIgnore[a.IP])
    list.sort((a, b) => a.ping - b.ping);

    let maxScore = -1;
    let chosenServer = null;
    for(let server of list) {
        let score = 1.0 - (server.ping / 3000.0) * 2.0 + server.numPlayers;
        if(score > maxScore) {
            maxScore = score;
            chosenServer = server;
        }
    }

    if(!chosenServer)
        return;
      
    quickJoinIgnore[chosenServer.IP] = true;
    dew.command(`Server.connect ${chosenServer.IP}`)
        .catch(err => {
            swal({
                title: "Failed to join",
                text: err.message
            });
        });
}

swal.setDefaults({
    target: ".page_content",
    customClass: "alertWindow",
    buttonsStyling: false,
    confirmButtonClass: "alertButton alertConfirm",
    cancelButtonClass: "alertButton alertCancel",
    confirmButtonText: "<img src='dew://assets/buttons/XboxOne_A.png'>OK",
    cancelButtonText: "<img src='dew://assets/buttons/XboxOne_B.png'>Cancel"
})

function parseVersion(str) { 
    var result = 0;
    var suffixPos = str.indexOf('-');
    if(suffixPos != -1)
        str = str.substr(0, suffixPos);
    
    var parts = str.split('.');
    for(var i = 0; i < parts.length && i < 4; i++) {
        result |= (parseInt(parts[i]) << (24-(i*8)));
    }  
    return result;
}


function reflect(p) {
	return p.then(v => ({v, success: true }),  e => ({e, success: false }));
}

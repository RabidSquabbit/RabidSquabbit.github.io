const masterServers = [
    "http://158.69.166.144:8080/list",
    "http://eldewrito.red-m.net/list"
];

let pingQueue = [];
let pingCounter= 0;
let pingSet = {};
let model = {
    currentSortKey: 'numPlayers',
    currentSortDir: 'desc',
    currentServerList: [],
    currentFilter: '',
    playerCount: 0,
    serverCount: 0
};
let officialServers = {};
let refreshVersion = 0;
let inflightRequests = [];
let refreshing = false;
let visible = false;


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
        dew.command(`Server.connect ${server}`);
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
    dew.command('Game.HideH3UI 1');
    dew.command('Settings.Gamepad').then((result) => {
        result = parseInt(result);
        //if(result) {
            document.body.setAttribute('data-gamepad-enabled', true);
       // } else {
       //     document.body.removeAttribute('data-gamepad-enabled');
       // }
    });
    refresh();
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
        }else{
            swal({
                title: "Joining Game",
                text: "Attempting to join selected game..."
            });
        }
    }
});


dew.ui.on('action', function({inputType, action}) {
    switch(action) {
        case dew.ui.Actions.X:
        if(inputType !== 'keyboard') {
            handleUserRefresh();
        }         
        break;
        case dew.ui.Actions.B:
            closeBrowser();
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

function cancelRefresh() {
    while(inflightRequests.length) {
        let request = inflightRequests.pop();
        request.abort();
    }    
    onRefreshEnded();
    refreshVersion++;
}

function refresh() {
    cancelRefresh();
    
    model.currentServerList = [];
    model.playerCount = 0;
    model.serverCount = 0;
    officialServers = {};
    pingQueue = [];
    pingCounter = 0;
    
    onRefreshStarted();
    render();

    fetch('http://new.halostats.click/api/officialservers', {})
    .then((resp) => resp.json())
    .then(resp => {
        for(let server of resp) {
            officialServers[server.address] = server
        }
        render();
    });

    let visited = {};
    for (let i = 0; i< masterServers.length; i++){
        fetch(masterServers[i], {})
        .then((resp) => resp.json())
        .then(function (data) {
            if (data.result.code)
                return;
            for (let serverIP of data.result.servers) {
                if(visited[serverIP]) {
                    continue;
                }
                visited[serverIP] = true;
                pingCounter++;
                pingQueue.push( { server: serverIP, refreshVersion: refreshVersion } );
            }
        });
    }
}

function onRefreshStarted() {
    var refreshButton = document.getElementById('refresh');
    var refreshLegendLink = document.getElementById('refreshLegendLink');
    refreshButton.classList.add('refreshing');
    refreshLegendLink.innerHTML = 'Stop';
    refreshing = true;
}


function onRefreshEnded() {
    var refreshButton = document.getElementById('refresh');
    var refreshLegendLink = document.getElementById('refreshLegendLink');
    refreshButton.classList.remove('refreshing');
    refreshLegendLink.innerHTML = 'Refresh';
    refreshing = false;
}

setInterval(function () {
    if (!pingQueue.length)
        return;
    var serverInfo = pingQueue.pop();

    ping(serverInfo).then((info) => {
        if(refreshVersion != serverInfo.refreshVersion)
            return;
        addServer(info);
    })
    .catch(() => {})
    .then(() => {

        if(--pingCounter <= 0)
            onRefreshEnded();

        if(refreshVersion != serverInfo.refreshVersion)
            return;  
    });
}, 25);


function ping(info) {

    return new Promise((resolve, rejeect) => {
        var xhr = new XMLHttpRequest();
        xhr.open('GET',`http://${info.server}/`, true);
        xhr.timeout = 3000;

        let startTime = -1;
    
        xhr.ontimeout = rejeect;
        xhr.onerror = rejeect;
        xhr.onload = function() {
            let data = JSON.parse(xhr.response);
            let endTime = Date.now();
            let ping = Math.round((endTime - startTime) * .45);
            let officialStatus = officialServers[info.server];

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
        { key: server.IP, 'data-ip': server.IP,  'data-type': server.type},
        React.createElement(
            'td',
            null,
            server.type
        ),
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
                    { onMouseDown: () => model.sort('type'), className: model.currentSortKey == 'type' ? `sort-${model.currentSortDir}` : '' },
                    'type'
                ),
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

function render() {
    let list = model.currentServerList.filter(a => a.name.toLowerCase().indexOf(model.currentFilter) != -1);
    ReactDOM.render(
        React.createElement(ServerList, { serverList: list, sort: onSort, search: onSearch, currentSortKey: model.currentSortKey, currentSortDir: model.currentSortDir }, null),
        document.getElementById('server-list-wrap')
    );
    serverListWidget.refresh();
    document.getElementById('population').innerHTML = `${model.playerCount} Players / ${model.serverCount} Servers`;
}

function sanitize(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

swal.setDefaults({
    target: ".page_content",
    customClass: "alertWindow",
    confirmButtonClass: "alertButton alertConfirm",
    cancelButtonClass: "alertButton alertCancel",
    confirmButtonText: "<img class='button'>Ok",
    cancelButtonText: "<img class='button'>Cancel"
})
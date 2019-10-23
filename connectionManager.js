var io = require('socket.io')(process.env.PORT || 3000);

const spawnPosition = {
    x: 0,
    y: 0,
    z: 0
};

var players = {};
var mySql;

var InitializeUser = ((socket, playerInfo) => {
    var player = {
        id: playerInfo.id,
        username: playerInfo.username,
        position: {
            x: playerInfo.position.x == null ? 0 : playerInfo.position.x,
            y: playerInfo.position.y == null ? 0 : playerInfo.position.y,
            z: playerInfo.position.z == null ? 0 : playerInfo.position.z,
        }
    };

    socket.emit('register', player);

    players[playerInfo.id] = player;

    for (var key in players) {
        if (players[key].id == player.id) {
            continue;
        }
        
        socket.emit('spawn', players[key]);
    }

    socket.broadcast.emit('spawn', player);

    return player;
});

var PersistPlayerState = ((player) => {
    var request = new mySql.Request();
    request.query(
        `UPDATE [dbo].[Players]
        SET LocationX=${player.position.x},
            LocationY=${player.position.y},
            LocationZ=${player.position.z}
        WHERE Id='${player.id}'`,
        (err, results) => {
            if (err) {
                console.log(err);
                return;
            }

            console.log('persisted player ' + player.id);
        }
    )
});

var OnLogin = ((socket, data, successCallback) => {
    console.log('login ' + data.username);

    if (!data.username || !data.password) {
        console.log('missing username or password');
        socket.emit('loginFailed', { reason: 'BadArguments' });
        return;
    }

    var playerId;
    var request = new mySql.Request();
    request.query(
        `SELECT * FROM [dbo].[Players] WHERE Username='${data.username}'`,
        (err, results) => {
            if (err) {
                console.log(err);
                socket.emit('loginFailed')
                return;
            }

            if (results.recordset.length == 0) {
                console.log('user not found, creating one');
                playerId = shortid.generate();

                request.query(
                    `INSERT INTO [dbo].[Players] (Id, Username, Password)
                    VALUES ('${playerId}', '${data.username}', '${data.password}')`,
                    (err, results) => {
                        if (err) {
                            console.log(err);
                            socket.emit('loginFailed');
                            return;
                        }

                        console.log('created user ' + playerId);
                        socket.emit('loginSucceeded', { id: playerId });
                        InitializeUser(
                            socket,
                            {
                                id: playerId,
                                username: data.username,
                                position: {
                                    x: spawnPosition.x,
                                    y: spawnPosition.y,
                                    z: spawnPosition.z
                                }
                            });
                    });
                successCallback(playerId);
                return;
            }

            for (var i = 0; i < results.recordset.length; i++) {
                if (results.recordset[i].Password === data.password) {

                    for (var key in players) {
                        if (players[key].id === results.recordset[i].Id) {
                            console.log('player ' + players[key].id + ' already connected');
                            socket.emit('loginFailed', { reason: 'AlreadyConnected' });
                            return;
                        }
                    }

                    playerId = results.recordset[i].Id;

                    console.log('player ' + playerId + ' successfully logged in');
                    socket.emit('loginSucceeded', { id: playerId })
                    InitializeUser(
                        socket,
                        {
                            id: playerId,
                            username: results.recordset[i].Username,
                            position: {
                                x: results.recordset[i].LocationX,
                                y: results.recordset[i].LocationY,
                                z: results.recordset[i].LocationZ,
                            }
                        });
                    successCallback(playerId);
                    return;
                }
            }

            console.log('password mismatch');
            socket.emit('loginFailed', { reason: 'IncorrectPassword' });
        });
});

var OnMove = ((socket, playerId, data) => {
    var player = players[playerId];
    if (!player) {
        console.log('could not find player ' + playerId);
        return;
    }

    player.position.x = data.x;
    player.position.y = data.y;
    player.position.z = data.z;
    
    socket.broadcast.emit('move', player);
});

var OnFollow = ((socket, playerId, data) => {
    console.log(playerId + ' started following ' + data.id);

    if (!players[data.id]) {
        console.log('could not find player ' + data.id);
        return;
    }

    if (!players[playerId]) {
        console.log('could not find player ' + playerId);
        return;
    }

    var outData = {
        targetId: data.id,
        id: playerId
    };
    
    socket.broadcast.emit('follow', outData);
});

var OnFollowing = ((playerId, data) => {
    var player = players[playerId];
    if (!player) {
        console.log('could not find player ' + playerId);
        return;
    }

    player.position.x = data.x;
    player.position.y = data.y;
    player.position.z = data.z;
});

var OnAttack = ((socket, playerId, data) => {
    console.log(playerId + ' attacked ' + data.id);

    if (!players[playerId]) {
        console.log('could not find player ' + playerId);
        return;
    }

    if (!players[data.id]) {
        console.log('could not find player ' + data.id);
        return;
    }

    var outData = {
        targetId: data.id,
        id: playerId
    };

    io.emit('attack', outData);
});

var OnDied = ((socket, playerId) => {
    console.log(playerId + ' died');

    var player = players[playerId];
    if (!player) {
        console.log('could not find player ' + playerId);
        return;
    }

    player.position.x = spawnPosition.x;
    player.position.y = spawnPosition.y;
    player.position.z = spawnPosition.z;

    setTimeout(function() {
        console.log('respawning ' + playerId);
        io.emit('respawn', player);
    }, 5000);
});

var OnUpdatePosition = ((socket, playerId, data) => {
    var player = players[playerId];
    if (!player) {
        console.log('could not find player ' + playerId);
        return;
    }

    player.position.x = data.x;
    player.position.y = data.y;
    player.position.z = data.z;

    socket.broadcast.emit('updatePosition', player);
});

var OnDisconnect = ((socket, playerId) => {
    console.log(playerId + ' disconnected');
    var player = players[playerId];
    if (!player) {
        console.log('could not find player ' + playerId);
        return;
    }

    PersistPlayerState(player);
    delete players[playerId];
    socket.broadcast.emit('disconnected', { id: playerId });
});

module.exports = {
    Initialize: function (sql) {
        var promise = new Promise(function(resolve, reject) {
            mySql = sql;

            io.on('connection', function(socket) {
                console.log('new client connected on socket ' + socket.id);
                var clientId;

                socket.on('login', function(data) {
                    OnLogin(socket, data, (id) => { clientId = id; });
                });

                socket.on('move', function(data) {
                    if (!clientId) {
                        console.log('client not authenticated');
                        return;
                    }

                    OnMove(socket, clientId, data);
                });

                socket.on('follow', function(data) {
                    if (!clientId) {
                        console.log('client not authenticated');
                        return;
                    }

                    OnFollow(socket, clientId, data);
                });

                socket.on('following', function(data) {
                    if (!clientId) {
                        console.log('client not authenticated');
                        return;
                    }

                    OnFollowing(clientId, data);
                });

                socket.on('attack', function(data) {
                    if (!clientId) {
                        console.log('client not authenticated');
                        return;
                    }

                    OnAttack(socket, clientId, data);
                });

                socket.on('died', function(data) {
                    if (!clientId) {
                        console.log('client not authenticated');
                        return;
                    }

                    OnDied(socket, clientId);
                });

                socket.on('updatePosition', function(data) {
                    if (!clientId) {
                        console.log('client not authenticated');
                        return;
                    }

                    OnUpdatePosition(socket, clientId, data);
                });

                socket.on('disconnect', function(data) {
                    if (!clientId) {
                        console.log('client not authenticated');
                        return;
                    }

                    OnDisconnect(socket, clientId);
                });
            });

            console.log("connection manager initialized");
            resolve();
        });
        
        return promise;
    },
}
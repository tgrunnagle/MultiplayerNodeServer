var io = require('socket.io')(process.env.PORT || 3000);
var mathjs = require('mathjs');
var shortid = require('shortid');

const spawnPosition = {
    x: 0,
    y: 0,
    z: 0
};
const minAttackDistance = 0.1;
const tableName = "Players";

var players = {};
var mySql;

var GetDistance = ((a, b) => {
    return mathjs.distance(
        [ a.x, a.y, a.z ],
        [ b.x, b.y, b.z ]
    );
});

var InitializePlayer = ((socket, playerInfo) => {
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
    for (var i = 0; i < 11; i++) {
        socket.broadcast.emit(
            'chat',
            { username: 'Deus', message: 'Please welcome ' + player.username + ' to the game! ' + i });

        }
    return player;
});

var PersistPlayerState = ((player) => {
    var request = new mySql.Request();
    request.query(
        `UPDATE [dbo].[${tableName}]
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
        `SELECT * FROM [dbo].[${tableName}] WHERE Username='${data.username}'`,
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
                    `INSERT INTO [dbo].[${tableName}] (Id, Username, Password)
                    VALUES ('${playerId}', '${data.username}', '${data.password}')`,
                    (err, results) => {
                        if (err) {
                            console.log(err);
                            socket.emit('loginFailed');
                            return;
                        }

                        console.log('created user ' + playerId);
                        socket.emit('loginSucceeded', { id: playerId });
                        InitializePlayer(
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
                    InitializePlayer(
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

// TODO possible client hack - emit 'move' then 'attack' while still
// far away from the target. Server will allow it because
// it sets the location immediately on move while the client sets
// the destination on move.
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

    var sourcePlayer = players[playerId];
    if (!sourcePlayer) {
        console.log('could not find player ' + playerId);
        return;
    }

    var targetPlayer = players[data.id];
    if (!targetPlayer) {
        console.log('could not find player ' + data.id);
        return;
    }

    // check if the attacker is within range
    var distance = GetDistance(sourcePlayer.position, targetPlayer.position);
    if (distance <= minAttackDistance) {
        var outData = {
            targetId: data.id,
            id: playerId
        };
    
        io.emit('attack', outData);
    }
    else {
        console.log('target is too far away (' + distance + ')');
    }
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

var OnChat = ((socket, playerId, data) => {
    var sender = players[playerId];
    if (!sender) {
        console.log('could not find player ' + playerId);
    }
    
    console.log(sender.username + ' said: ' + data.message);

    data.username = sender.username;
    socket.broadcast.emit('chat', data);
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

                socket.on('chat', function(data) {
                    if (!clientId) {
                        console.log('client not authenticated');
                        return;
                    }

                    OnChat(socket, clientId, data);
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
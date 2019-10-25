var io = require('socket.io')(process.env.PORT || 3000);
var mathjs = require('mathjs');
var shortid = require('shortid');

const spawnPosition = {
    x: 0,
    y: 0,
    z: 0
};
const minAttackDistance = 4;
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
    socket.broadcast.emit(
        'chat',
        { message: player.username + ' has entered the game!' });
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

var CreatePlayerRecord = ((data) => {
    var promise = new Promise(function(resolve, reject) {
        var playerId = shortid.generate();
        var request = new mySql.Request();
        request.query(
            `INSERT INTO [dbo].[${tableName}] (Id, Username, Password)
            VALUES ('${playerId}', '${data.username}', '${data.password}')`,
            (error, results) => {
                if (error) {
                    reject(error);
                    return;
                }
    
                console.log('created user record for ' + data.username + ' with id ' + playerId);
                resolve(playerId);
            });
    });

    return promise;
});

var OnLogin = ((socket, data) => {
    console.log(data.username + ' is attempting to login');

    var promise = new Promise(function(resolve, reject) {
        if (!data.username || !data.password) {
            socket.emit('login', { success: false, failureReason: 'Missing arguments' });
            reject('missing username or password');
            return;
        }

        var request = new mySql.Request();
        request.query(
            `SELECT * FROM [dbo].[${tableName}] WHERE Username='${data.username}'`,
            (error, results) => {
                if (error) {
                    socket.emit('login', { success: false, failureReason: 'Internal error' });
                    reject(error)
                    return;
                }

                if (results.recordset.length == 0) {
                    console.log('user not found, creating one');
                    CreatePlayerRecord(data)
                        .then((playerId) => {
                            socket.emit(
                                'login',
                                {
                                    success: true,
                                    id: playerId,
                                    username: data.username,
                                });

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
                            resolve({
                                id: playerId,
                                username: data.username
                            });
                        })
                        .catch((error) => {
                            socket.emit('login', { success: false, failureReason: 'Internal error' });
                            reject(error);
                        });
                    return;
                }

                if (results.recordset.length > 1) {
                    socket.emit('login', { success: false, failureReason: 'Internal error' });
                    reject('Found ' + results.recordset.length + ' players with username ' + data.username);
                    return;
                }

                var playerRecord = results.recordset[0];
                if (playerRecord.Password !== data.password) {
                    socket.emit('login', { successed: false, failureReason: 'Incorrect password' });
                    reject('incorrect password for ' + data.username);
                    return;
                }

                for (var key in players) {
                    if (players[key].id === playerRecord.Id) {
                        socket.emit('login', { success: false, failureReason: 'Already logged in' });
                        reject('player ' + playerRecord.Username + ' is already logged in');
                        return;
                    }
                }

                socket.emit(
                    'login',
                    {
                        success: true,
                        id: playerRecord.Id,
                        username: playerRecord.Username,
                    });
                InitializePlayer(
                    socket,
                    {
                        id: playerRecord.Id,
                        username: playerRecord.Username,
                        position: {
                            x: playerRecord.LocationX,
                            y: playerRecord.LocationY,
                            z: playerRecord.LocationZ,
                        }
                    });
                resolve({
                    id: playerRecord.Id,
                    username: playerRecord.Username
                });
            });
    });
    
    return promise;
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

var LogPlayerCount = (() => {
    var count = 0;
    for (var key in players) {
        count++;
    }

    console.log('there are currently ' + count + ' players');
});

module.exports = {
    Initialize: function (sql) {
        var promise = new Promise(function(resolve, reject) {
            mySql = sql;

            io.on('connection', function(socket) {
                console.log('new client connected on socket ' + socket.id);
                var clientId;

                socket.on('login', function(data) {
                    OnLogin(socket, data)
                        .then((info) => {
                            console.log(info.username + ' (' + info.id + ') successfully logged in');
                            clientId = info.id;
                            LogPlayerCount();
                        })
                        .catch((error) => {
                            console.log(error);
                        });
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
                    LogPlayerCount();
                });
            });

            console.log("connection manager initialized");
            resolve();
        });
        
        return promise;
    },
}
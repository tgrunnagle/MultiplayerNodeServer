var io = require('socket.io')(process.env.PORT || 3000);
var shortid = require('shortid');
var sql = require('mssql');


var players = {};

var InitializeSocketIO = (() => {
    const spawnPosition = {
        x: 0,
        y: 0,
        z: 0
    };

    io.on('connection', function(socket) {
        var authenticated = false;
        var clientId;
        var player;

        console.log('new connection');

        var InitializeUser = ((playerInfo) => {
            socket.emit('register', { id: playerInfo.id });

            player = {
                id: playerInfo.id,
                username: playerInfo.username,
                position: {
                    x: playerInfo.position.x == null ? 0 : playerInfo.position.x,
                    y: playerInfo.position.y == null ? 0 : playerInfo.position.y,
                    z: playerInfo.position.z == null ? 0 : playerInfo.position.z,
                }
            };

            players[playerInfo.id] = player;
            for (var key in players) {
                if (players[key].id == player.id) {
                    continue;
                }
                
                socket.emit('spawn', players[key]);
            }

            socket.broadcast.emit('spawn', player);
        });

        socket.on('login', function(data) {
            console.log('login ' + data.username);

            if (!data.username || !data.password) {
                console.log('missing username or password');
                socket.emit('loginFailed', { reason: 'BadArguments' });
                return;
            }

            var request = new sql.Request();
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
                        clientId = shortid.generate();

                        request.query(
                            `INSERT INTO [dbo].[Players] (Id, Username, Password)
                            VALUES ('${clientId}', '${data.username}', '${data.password}')`,
                            (err, results) => {
                                if (err) {
                                    console.log(err);
                                    socket.emit('loginFailed');
                                    return;
                                }

                                console.log('created user ' + clientId);
                                socket.emit('loginSucceeded', { id: clientId });
                                authenticated = true;
                                InitializeUser({
                                    id: clientId,
                                    username: data.username,
                                    position: {
                                        x: spawnPosition.x,
                                        y: spawnPosition.y,
                                        z: spawnPosition.z
                                    }
                                });
                            });
                        return;
                    }

                    for (var i = 0; i < results.recordset.length; i++) {
                        if (results.recordset[i].Password === data.password) {
                            clientId = results.recordset[i].Id;
                            console.log('password matched user ' + clientId);
                            socket.emit('loginSucceeded', { id: clientId})
                            authenticated = true;
                            InitializeUser({
                                id: clientId,
                                username: results.recordset[i].Username,
                                position: {
                                    x: results.recordset[i].LocationX,
                                    y: results.recordset[i].LocationY,
                                    z: results.recordset[i].LocationZ,
                                }
                            });
                            return;
                        }
                    }

                    console.log('password mismatch');
                    socket.emit('loginFailed', { reason: 'IncorrectPassword' });
                });
        });

        // client move handler
        socket.on('move', function(data) {
            player.position.x = data.x;
            player.position.y = data.y;
            player.position.z = data.z;
            
            // broadcast to other players
            socket.broadcast.emit('move', player);
        });

        socket.on('follow', function(data) {
            console.log(clientId + ' started following ' + data.id);
            var outData = {
                targetId: data.id,
                id: clientId
            };
            
            socket.broadcast.emit('follow', outData);
        });

        socket.on('following', function(data) {
            // no need to broadcast - 'follow' broadcasts
            player.position.x = data.x;
            player.position.y = data.y;
            player.position.z = data.z;
        });

        socket.on('attack', function(data) {
            console.log(clientId + ' attacked ' + data.id);
            var outData = {
                targetId: data.id,
                id: clientId
            };
            
            // broadcast to all clients (including orginal sender)
            io.emit('attack', outData);
        })

        socket.on('died', function(data) {
            console.log(clientId + ' died');
            
            setTimeout(function() {
                console.log('respawning ' + clientId);
                
                player.position.x = spawnPosition.x;
                player.position.y = spawnPosition.y;
                player.position.z = spawnPosition.z;
                
                io.emit('respawn', player);
            }, 5000);
                        
        });

        socket.on('updatePosition', function(data) {
            data.id = clientId;
            
            player.position.x = data.x;
            player.position.y = data.y;
            player.position.z = data.z;
            
            socket.broadcast.emit('updatePosition', data);
        });

        // client disconnect handler
        socket.on('disconnect', function() {
            console.log('client ' + clientId + ' disconnected');
            if (players[clientId] != null) {
                delete players[clientId];
                socket.broadcast.emit('disconnected', { id: clientId });
            }
        });
    });

    console.log('socket server started');
});

const sqlConfig = {
    user: 'trey',
    password: '',
    server: 'DESKTOP1\\SQLEXPRESS',
    database: 'MultiplayerNode',
    port: 1433
};

console.log('connecting to DB ' + sqlConfig.database);
sql.connect(sqlConfig)
    .then(pool => {
        console.log('successfully connected to DB ' + sqlConfig.database);
        InitializeSocketIO();
    })
    .catch(err => {
        console.log(err);
    });

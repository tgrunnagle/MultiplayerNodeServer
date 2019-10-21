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

        socket.on('login', function(data) {
            console.log('login ' + data.username);
            var request = new sql.Request();
            request.query('select * FROM Players', (err, results) => {
                if (err) {
                    console.log(err);
                    return;
                }

                console.log(results);
            });
        });

        var clientId = shortid.generate();
        console.log('client ' + clientId + ' connected');

        var player = {
            id: clientId,
            position: {
                x: spawnPosition.x,
                y: spawnPosition.y,
                z: spawnPosition.z
            }
        };

        players[clientId] = player;

        // send existing players to new client
        for (var key in players) {
            if (players[key].id == clientId) {
                continue;
            }
            
            socket.emit('spawn', players[key]);
        }

        socket.emit('register', { id: clientId });

        // new player, broadcast to others
        socket.broadcast.emit('spawn', player);

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

        var request = new sql.Request();
        request.query('SELECT * FROM Players', (err, results) => {
            console.log(err);
        });
    })
    .catch(err => {
        console.log(err);
    });

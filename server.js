var io = require('socket.io')(process.env.PORT || 3000);
var shortid = require('shortid');

console.log('server started.');

var spawnPosition = {
    x: 0,
    y: 0,
    z: 0
};

var players = {};

io.on('connection', function(socket) {
    
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
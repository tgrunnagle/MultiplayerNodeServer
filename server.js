var io = require('socket.io')(process.env.PORT || 3000);
var shortid = require('shortid');

console.log('server started.');

var players = {};

io.on('connection', function(socket) {
    
    var clientId = shortid.generate();
    console.log('client ' + clientId + ' connected.');
    
    var player = {
        id: clientId,
        position: {
            x: 0,
            y: 0,
            z: 0
        }
    };
    
    players[clientId] = player;
    
    // send existing players to new client
    for (var key in players) {
        if (players[key].id == clientId) {
            continue;
        }
        
        socket.emit(
            'spawn',
            {
                id: players[key].id,
                x: players[key].position.x,
                y: players[key].position.y,
                z: players[key].position.z
            });
    }
    
    socket.emit('register', { id: clientId });
    
    // new player, broadcast to others
    socket.broadcast.emit(
        'spawn',
        {
            id: clientId,
            x: player.position.x,
            y: player.position.y,
            z: player.position.z
        });
    
    // client move handler
    socket.on('move', function(data) {
        data.id = clientId;
        
        player.position.x = data.x;
        player.position.y = data.y;
        player.position.z = data.z;
        
        // broadcast to other players
        socket.broadcast.emit('move', data);
    });
    
    socket.on('follow', function(data) {
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
    
    socket.on('updatePosition', function(data) {
        data.id = clientId;
        
        player.position.x = data.x;
        player.position.y = data.y;
        player.position.z = data.z;
        
        socket.broadcast.emit('updatePosition', data);
    });
    
    // client disconnect handler
    socket.on('disconnect', function() {
        console.log('client ' + clientId + ' disconnected.');
        if (players[clientId] != null) {
            delete players[clientId];
            socket.broadcast.emit('disconnected', { id: clientId });
        }
    });
});
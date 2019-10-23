var sqlManager = require('./sqlManager');
var connectionManager = require('./connectionManager');

sqlManager
    .Connect()
    .then(function (sql) {
        connectionManager
            .Initialize(sql)
            .then(function() {
                console.log('server successfully started');
            });
    });

var sqlManager = require('./sqlManager');
var playerManager = require('./playerManager');


sqlManager
    .Connect()
    .then(function (sql) {
        playerManager
            .Initialize(sql)
            .then(function() {
                console.log('server successfully started');
            });
    });

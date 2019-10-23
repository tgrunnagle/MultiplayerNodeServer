var sql = require('mssql');

const sqlConfig = {
    user: 'trey',
    password: '',
    server: 'DESKTOP1\\SQLEXPRESS',
    database: 'MultiplayerNode',
    port: 1433
}

module.exports = {
    Connect: function() {
        var promise = new Promise(function(resolve, reject) {
            console.log('connecting to DB ' + sqlConfig.database);
            sql.connect(sqlConfig)
                .then((pool) => {
                    console.log('successfully connected to DB');
                    resolve(sql);
                })
                .catch((error) => {
                    console.log(error);
                    reject(error);
                });
            });
        return promise;
    }
}
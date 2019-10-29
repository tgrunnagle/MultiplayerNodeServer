var sql = require('mssql');

// const sqlConfig = {
//     user: 'trey',
//     password: '',
//     server: 'DESKTOP1\\SQLEXPRESS',
//     database: 'MultiplayerNode',
//     port: 1433,
// }

const sqlConfig = {
    user: '',
    password: '',
    server: 'multiplayernode.database.windows.net',
    database: 'MultiplayerNode',
    port: 1433,
    options: {
        encrypt: true
    }
}

module.exports = {
    Connect: function() {
        var promise = new Promise(function(resolve, reject) {
            console.log('connecting to SQL DB ' + sqlConfig.server + ' ' + sqlConfig.database);
            sql.connect(sqlConfig)
                .then((pool) => {
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
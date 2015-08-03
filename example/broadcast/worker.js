var os = require('os');
var worker_name = os.hostname() + ':' + process.pid;
var counter = 0;

var rpc = require('../../index').factory({
    url: "amqp://tdev1:mq4tdev1@127.0.0.1:5672"
});

rpc.on('getWorkerStat', function (params, cb) {
    console.log("getWorkerStat: " + worker_name);
    if (params && params.type == 'fullStat') {
        cb(null, {
            pid: process.pid,
            hostname: os.hostname(),
            uptime: process.uptime(),
            counter: counter++
        });
    }
    else {
        cb(null, {counter: counter++})
    }
}, {queueName: "test-" + process.pid});


rpc.rpcCall('log', {worker: worker_name, message: 'worker started'});
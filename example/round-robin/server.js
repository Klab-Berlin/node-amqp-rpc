Object.defineProperty(Error.prototype, 'toJSON', {
    value: function () {
        var alt = {};

        Object.getOwnPropertyNames(this).forEach(function (key) {
            alt[key] = this[key];
        }, this);

        return alt;
    },
    configurable: true
});


var rpc = require('../../index').factory({
    exchange: "uuu-test", exchange_options: {exclusive: false, autoDelete: true},
    conn_options: {url: "amqp://guest:guest@rabbitmq:5672", heartbeat: 10}
});


rpc.subscribe('zzttrr', function(param, cb){
    var prevVal = param;
    var nextVal = param + 2;
    cb(++param, prevVal, nextVal);
}, {queueName: "test_inc"});

rpc.subscribe('say.*', function (param, cb, inf) {
    var arr = inf.cmd.split('.');

    var name = (param && param.name) ? param.name : 'world';

    cb(arr[1] + ' ' + name + '!');

});

rpc.subscribe('withoutCB', function (param, cb, inf) {

    if (cb) {
        cb('please run function without cb parameter')
    }
    else {
        console.log('this is function withoutCB');
    }

});

rpc.subscribe('errorFn', function (param, cb) {
    cb(new Error("errorFn"), null);
});

rpc.subscribe('waitsTooMuch', function (param, cb) {
    console.log("waitsTooMuch");
    //cb("waitsTooMuch OK!");
    setTimeout(cb.bind(null, "waitsTooMuch OK!"), 5000);
});

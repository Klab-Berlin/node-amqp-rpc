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
  conn_options: {url: "amqp://tdev1:mq4tdev1@127.0.0.1:5672", heartbeat: 10 }
});


rpc.on('inc', function(param, cb){
    var prevVal = param;
    var nextVal = param+2;
    cb(++param, prevVal, nextVal);
});

rpc.on('say.*', function(param, cb, inf){
    console.log(param);
    console.log(inf);
    console.log(arguments);
    var arr = inf.cmd.split('.');

    var name = (param && param.name) ? param.name : 'world';

    cb(arr[1] + ' ' + name + '!');

});

rpc.on('withoutCB', function(param, cb, inf) {

  if(cb){
    cb('please run function without cb parameter')
  }
  else{
    console.log('this is function withoutCB');
  }

});

rpc.on('errorFn', function (param, cb) {
    cb(new Error("errorFn"), null);
});


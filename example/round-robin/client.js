Object.defineProperty(Error, 'fromJSON', {
	value: function (other) {
		var err = new Error();
		Object.getOwnPropertyNames(other).forEach(function (key) {
			err[key] = other[key];
		});
		return err;
	},
	configurable: true
});

var rpc = require('../../index').factory({
	conn_options: {url: "amqp://tdev1:mq4tdev1@127.0.0.1:5672", heartbeat: 10, confirm: true}
});

rpc.rpcCall('inc', 5, null, null, function () {
	console.log('results of inc:', arguments);  //output: [6,4,7]
});

rpc.rpcCall('say.Hello', {name: 'John'}, null, null, function (msg) {
	console.log('results of say.Hello:', msg);  //output: Hello John!
});

rpc.rpcCall('withoutCB', {}, null, null, function (msg) {
	console.log('withoutCB results:', msg);  //output: please run function without cb parameter
});

//rpc.rpcCall('withoutCB', {}); //output message on server side console

//rpc.rpcCall('errorFn', null, null, null, function (err, succ) {
//    throw Error.fromJSON(err);
//});

//rpc.rpcCall('waitsTooMuch', null, null, console, console.log);
//rpc.rpcCall('waitsTooMuch', null, null, console, console.log);

rpc.rpcCall('waitsTooMuch', null, {"expiration": "3000"}, console, console.log);
rpc.rpcCall('waitsTooMuch', null, {"expiration": "3000"}, console, console.log);

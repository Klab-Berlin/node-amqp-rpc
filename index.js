var amqp = require('amqp');
var uuid = require('node-uuid').v4;
var os = require('os');
var queueNo = 0;

function rpc(opt) {

    if (!opt) opt = {};
    this.opt = opt;
    this.__conn = opt.connection ? opt.connection : null;
    this.__url = opt.url ? opt.url : 'amqp://guest:guest@localhost:5672';
    this.__exchange = opt.exchangeInstance ? opt.exchangeInstance : null;
    this.__exchange_name = opt.exchange ? opt.exchange : 'rpc_exchange';
    this.__exchange_options = opt.exchange_options ? opt.exchange_options : {exclusive: false, autoDelete: true};
    this.__impl_options = opt.ipml_options || {defaultExchangeName: this.__exchange_name};
    this.__conn_options = opt.conn_options || {};

    this.__results_queue = null;
    this.__results_queue_name = null;
    this.__results_cb = {};
    this.__make_results_cb = [];

    this.__cmds = {};

    this.__connCbs = [];
    this.__exchangeCbs = [];
}

/**
 * generate unique name for new queue
 * @returns {string}
 */

rpc.prototype.generateQueueName = function (type) {
    return uuid() + ':' + os.hostname() + ':pid' + process.pid + ':' + type;
}


rpc.prototype._connect = function (cb) {

    if (!cb) {
        cb = function () {
        };
    }

    if (this.__conn) {

        if (this.__connCbs.length > 0) {

            this.__connCbs.push(cb);

            return true;
        }

        return cb(this.__conn);
    } else {
        this.__conn = this.opt.connection ? this.opt.connection : null;
    }

    var $this = this;

    this.__connCbs.push(cb);
    var options = this.__conn_options;
    if (!options.url && !options.host) options.url = this.__url;
    this.__conn = amqp.createConnection(
        options,
        this.__impl_options
    );

    this.__conn.on('error', function (err) {
        throw err;
    });

    this.__conn.on('ready', function () {
        var cbs = $this.__connCbs;
        $this.__connCbs = [];

        for (var i = 0; i < cbs.length; i++) {
            cbs[i]($this.__conn);
        }
    });
}
/**
 * disconnect from MQ broker
 */

rpc.prototype.disconnect = function () {
    if (!this.__conn) return;
    this.__conn.end();
    this.__conn = null;
}

rpc.prototype._makeExchange = function (cb) {

    if (!cb) {
        cb = function () {
        };
    }

    if (this.__exchange) {

        if (this.__exchangeCbs.length > 0) {

            this.__exchangeCbs.push(cb);

            return true;
        }

        return cb(this.__exchange);
    }

    var $this = this;

    this.__exchangeCbs.push(cb);
    /*
     * Added option autoDelete=false.
     * Otherwise we had an error in library node-amqp version > 0.1.7.
     * Text of such error: "PRECONDITION_FAILED - cannot redeclare exchange '<exchange name>' in vhost '/' with different type, durable, internal or autodelete value"
     */
    this.__exchange = this.__conn.exchange(this.__exchange_name, {autoDelete: false}, function (exchange) {
        var cbs = $this.__exchangeCbs;
        $this.__exchangeCbs = [];

        for (var i = 0; i < cbs.length; i++) {
            cbs[i]($this.__exchange);
        }
    });

}

rpc.prototype._makeResultsQueue = function (cb) {

    if (!cb) {
        cb = function () {
        };
    }

    if (this.__results_queue) {
        if (this.__make_results_cb.length > 0) {

            this.__make_results_cb.push(cb);
            return true;
        }
        return cb(this.__results_queue);
    }

    var $this = this;

    this.__results_queue_name = this.generateQueueName('callback');
    this.__make_results_cb.push(cb);

    $this._makeExchange(function () {

        $this.__results_queue = $this.__conn.queue(
            $this.__results_queue_name,
            $this.__exchange_options,
            function (queue) {
                queue.subscribe(function () {
                    $this.__onResult.apply($this, arguments);
                });

                queue.bind($this.__exchange, $this.__results_queue_name);
                var cbs = $this.__make_results_cb;
                $this.__make_results_cb = [];

                for (var i = 0; i < cbs.length; i++) {
                    cbs[i](queue);
                }
            }
        );
    });
}

rpc.prototype.__onResult = function (message, headers, deliveryInfo) {
    if (!this.__results_cb[deliveryInfo.correlationId]) return;

    var cb = this.__results_cb[deliveryInfo.correlationId];

    var args = [];
    if (Array.isArray(message)) {

        for (var i = 0; i < message.length; i++) {
            args.push(message[i]);
        }
    }
    else args.push(message);

    cb.cb.apply(cb.context, args);

    //if (cb.autoDeleteCallback !== false)
    delete this.__results_cb[deliveryInfo.correlationId];
}

rpc.prototype.setMessageTimeout = function (corr_id, timeout) {
    var $this = this;
    setTimeout(function () {
        //release cb
        if ($this.__results_cb[corr_id]) {
            delete $this.__results_cb[corr_id];
        }
    }, timeout);
};

/**
 * call a remote command
 * @param {string} cmd   command name
 * @param {Buffer|Object|String}params    parameters of command
 * @param {object} options   advanced options of amqp
 * @param {object} context   context of callback
 * @param {function} cb        callback
 *
 */

rpc.prototype.rpcCall = function (cmd, params, options, context, cb) {
    var $this = this;

    if (!options) options = {};

    options.expiration = options.expiration || "20000";
    options.contentType = 'application/json';
    var corr_id = options.correlationId || uuid();
    $this.setMessageTimeout(corr_id, options.expiration);

    this._connect(function () {

        if (cb) {

            $this._makeExchange(function () {

                $this._makeResultsQueue(function () {

                    $this.__results_cb[corr_id] = {
                        cb: cb,
                        context: context
                        //,
                        //autoDeleteCallback: !!options.autoDeleteCallback
                    };


                    options.mandatory = true;
                    options.replyTo = $this.__results_queue_name;
                    options.correlationId = corr_id;
                    //options.domain    = "localhost";

                    $this.__exchange.publish(
                        cmd,
                        params,
                        options,
                        function (err) {
                            if (err) {
                                delete $this.__results_cb[corr_id];

                                cb(err);
                            }
                        }
                    );
                });
            });

        }
        else {

            $this._makeExchange(function () {

                $this.__exchange.publish(
                    cmd,
                    params,
                    options
                );
            });
        }
    });

    return corr_id;
}

rpc.prototype._getCurrentBindings = function (queueName, vhost, cb) {
    var myRpc = new rpc({exchange: "rpc_exchange", conn_options: {url: this.opt.conn_options.url}});
    var routing = "rabbitmon";
    var message = {apiCall: "queues/" + vhost + "/" + queueName + "/bindings"};
    myRpc.rpcCall(routing, message, {expiration: "20000"}, null, function (err, res) {
        if (err) {
            console.error(err);
            throw err;
        }
        myRpc.disconnect();
        cb(res);
    });
};

rpc.prototype._deleteBindings = function (queue, bindingsToDelete) {
    var self = this;
    bindingsToDelete.forEach(function (b) {
        queue.bind(b.exchange, b.routing, function () {

            if (bindingsToDelete.length > 0) {
                console.log("======= Amqp monitoring: deleting preexisting bindings =======");
            }

            bindingsToDelete.forEach(function (b) {
                console.log("deleting binding: ", b);
                queue.unbind(b.exchange, b.routing);
            });

            if (bindingsToDelete.length > 0) {
                console.log("==============================================================");
            }

        });
    });
};

/**
 * add new command handler
 * @param {string} cmd                command name or match string
 * @param {function} cb               handler
 * @param {object} context            context for handler
 * @param {object} options            advanced options
 * @param {string} options.queueName  name of queue. Default equal to "cmd" parameter
 * @param {boolean} options.durable   If true, the queue will be marked as durable.
 *                                    Durable queues remain active when a server restarts.
 *                                    Non-durable queues (transient queues) are purged if/when a server restarts.
 *                                    Note that durable queues do not necessarily hold persistent messages,
 *                                    although it does not make sense to send persistent messages to a transient queue.

 * @param {boolean} options.exclusive Exclusive queues may only be accessed by the current connection,
 *                                    and are deleted when that connection closes.
 * @param {boolean} options.autoDelete If true, the queue is deleted when all consumers have finished using it.
 *                                     The last consumer can be cancelled either explicitly or because its channel is closed.
 *                                     If there was no consumer ever on the queue, it won't be deleted. Applications
 *                                     can explicitly delete auto-delete queues using the Delete method as normal.
 * @return {boolean}
 */


rpc.prototype.onParallel = function (cmd, cb, options, context) {
    if (this.__cmds[cmd]) return false;
    options || (options = {});

    var $this = this;
    options.queueName = options.queueName || cmd;

    this._connect(function () {

        $this.__conn.queue(options.queueName, function (queue) {
            $this.__cmds[cmd] = {queue: queue};
            queue.subscribe(function (message, d, headers, deliveryInfo) {

                var cmdInfo = {
                    cmd: deliveryInfo.routingKey,
                    exchange: deliveryInfo.exchange,
                    contentType: deliveryInfo.contentType,
                    size: deliveryInfo.size
                };

                if (deliveryInfo.correlationId && deliveryInfo.replyTo) {

                    return cb.call(context, message, function (err, data) {
                        var options = {
                            correlationId: deliveryInfo.correlationId
                        }

                        $this.__exchange.publish(
                            deliveryInfo.replyTo,
                            Array.prototype.slice.call(arguments),
                            options
                        );
                    }, cmdInfo);
                }
                else
                    return cb.call(context, message, null, cmdInfo);
            });

            $this.printChannels(options.queueName);

            $this._getCurrentBindings(options.queueName, "%2f", function (bindings) {
                var bindingsToDelete = bindings.map(function (b) {
                    return {exchange: b.source, routing: b.routing_key};
                }).filter(function (b) {
                    return b.exchange && b.exchange !== '';
                }).filter(function (b) {
                    return !(b.exchange === $this.__exchange_name && b.routing === cmd);
                });

                $this._deleteBindings(queue, bindingsToDelete);
            });

            $this._makeExchange(function () {
                queue.bind($this.__exchange, cmd);
            });

        });
    });


    return true;
}

/**
 * add new command handler, it handles a message per time, at the end it sends the ack to rabbitMQ
 * @param cmd
 * @param cb
 * @param context
 * @param options
 * @returns {boolean}
 */
rpc.prototype.on = function (cmd, cb, options, context) {
    if (this.__cmds[cmd]) return false;
    options || (options = {});

    var $this = this;

    options.queueName = options.queueName || cmd;

    this._connect(function () {
        $this.__conn.queue(options.queueName, function (queue) {
            $this.__cmds[cmd] = {queue: queue};

            queue.subscribe({
                ack: true
            }, function (message, d, headers, deliveryInfo) {

                var cmdInfo = {
                    cmd: deliveryInfo.routingKey,
                    exchange: deliveryInfo.exchange,
                    contentType: deliveryInfo.contentType,
                    size: deliveryInfo.size
                };

                if (deliveryInfo.correlationId && deliveryInfo.replyTo) {

                    return cb.call(context, message, function (err, data) {
                        queue.shift();
                        var options = {
                            correlationId: deliveryInfo.correlationId
                        }

                        $this.__exchange.publish(
                            deliveryInfo.replyTo,
                            Array.prototype.slice.call(arguments),
                            options
                        );
                    }, cmdInfo);
                }
                else
                    return cb.call(context, message, null, cmdInfo);
            });

            $this.printChannels(options.queueName);

            $this._getCurrentBindings(options.queueName, "%2f", function (bindings) {
                var bindingsToDelete = bindings.map(function (b) {
                    return {exchange: b.source, routing: b.routing_key};
                }).filter(function (b) {
                    return b.exchange && b.exchange !== '';
                }).filter(function (b) {
                    return !(b.exchange === $this.__exchange_name && b.routing === cmd);
                });

                $this._deleteBindings(queue, bindingsToDelete);
            });

            $this._makeExchange(function () {
                queue.bind($this.__exchange, cmd);
            });

        });
    });


    return true;
}

/**
 * remove command handler added with "on" method
 * @param {string} cmd       command or match string
 * @return {boolean}
 */

rpc.prototype.off = function (cmd) {
    if (!this.__cmds[cmd]) return false;

    var $this = this;

    var c = $this.__cmds[cmd];

    function unsubscribe(cb) {
        if (c.ctag)
            c.queue.unsubscribe(c.ctag);

        if (cb)
            return cb();
    }

    // other processes could remain bounded to the queue, so we cannot delete it

    //function unbind(cb) {
    //
    //    if (c.queue) {
    //        unsubscribe(function () {
    //            c.queue.unbind($this.__exchange, cmd);
    //
    //            if (cb)
    //                return cb();
    //        });
    //
    //    }
    //}
    //
    //function destroy(cb) {
    //
    //    if (c.queue) {
    //        unbind(function () {
    //            c.queue.destroy()
    //
    //            if (cb)
    //                return cb();
    //        });
    //    }
    //}

    //destroy(function () {
    delete $this.__cmds[cmd];
    //});

    return true;
}

/**
 * call broadcast
 * @param {string} cmd
 * @param params
 * @param options
 */


rpc.prototype.callBroadcast = function (cmd, params, options) {

    var $this = this;

    options || (options = {});
    options.broadcast = true;
    //options.autoDeleteCallback = options.ttl ? false : true;
    var corr_id = this.rpcCall.call(this, cmd, params, options, options.context, options.onResponse);
    if (options.ttl) {
        setTimeout(function () {
            //release cb
            if ($this.__results_cb[corr_id]) {
                delete $this.__results_cb[corr_id];
            }
            options.onComplete.call(options.context, cmd, options);
        }, options.ttl);
    }
}

rpc.prototype.printChannels = function (queueName) {
    var thisRabbit = this;
    thisRabbit._getChannels(queueName, function (channels) {
        if (channels.length > 0) {

            console.log("======= Amqp monitoring report =======");

            console.log("Channels in [" + queueName + "] queue: ");
            channels.forEach(function (v) {
                console.log("\t" + v);
            });

            console.log("======================================");

        }
    });
};

rpc.prototype._getChannels = function (queueName, cb) {
    var myRpc = new rpc({exchange: "rpc_exchange", conn_options: {url: this.opt.conn_options.url}});
    var routing = "rabbitmon";
    var message = {apiCall: "queues/" + "%2f" + "/" + queueName};
    myRpc.rpcCall(routing, message, {expiration: "20000"}, null, function (err, res) {
        if (err) {
            console.error(err);
            throw err;
        }
        myRpc.disconnect();
        var ipList = res.consumer_details.map(function (consumer) {
            return consumer.channel_details.connection_name;
        });

        cb(ipList);
    });
};

module.exports.amqpRPC = rpc;

module.exports.factory = function (opt) {
    return new rpc(opt);
}

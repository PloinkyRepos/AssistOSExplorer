/*
Initial License: (c) Axiologic Research & Alboaie Sînică.
Contributors: Axiologic Research , PrivateSky project
Code License: LGPL or MIT.
//This code is obsolete, but it is mantained for future performance testing
*/

function InternalBus() {
    let subscribersOnce = {};
    let subscribers = {};

    function FuncReference(callback) {
        this.call = function (obj) {
            callback(obj);
        };
    }

    function CallbackArray() {
        let arr = [];
        const self = this;
        self.push = function (callback) {
            let ref = new FuncReference(callback);
            arr.push(ref);
            return ref;
        };

        self.publish = function (obj) {
            arr.forEach(function (ref) {
                ref.call(obj);
            });
        };

        self.delete = function (ref) {
            let index = arr.indexOf(ref);
            arr.splice(index, 1);
        };

    }


    this.publish = function (topic, obj) {
        let c = subscribersOnce[topic];
        if (typeof c !== 'undefined') {
            c();
            delete subscribersOnce[topic];
        }
        let s = subscribers[topic];
        if (s) {
            s.publish(obj);
        }
    };
    
    this.subscribeOnce = function (topic, callback) {
        subscribersOnce[topic] = callback;
    };

    this.subscribe = function (topic, callback) {
        let s = subscribers[topic];
        if (!s) {
            subscribers[topic] = s = new CallbackArray();
        }
        return s.push(callback);
    };

    this.unsubscribe = function (topic, callback) {
        let s = subscribers[topic];
        if (s) {
            s.delete(callback);
        }
    };
}


exports.internalBus = new InternalBus();


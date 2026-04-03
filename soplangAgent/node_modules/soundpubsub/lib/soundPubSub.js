/*
Initial License: (c) Axiologic Research & Alboaie Sînică.
Contributors: Axiologic Research , PrivateSky project
Code License: LGPL or MIT.
*/


/**
 *   Usually an event could cause execution of other callback events . We say that is a level 1 event if is causeed by a level 0 event and so on
 *
 *      SoundPubSub provides intuitive results regarding to asynchronous calls of callbacks and computed values/expressions:
 *   we prevent immediate execution of event callbacks to ensure the intuitive final result is guaranteed as level 0 execution
 *   we guarantee that any callback function is "re-entrant"
 *   we are also trying to reduce the number of callback execution by looking in queues at new messages published by
 *   trying to compact those messages (removing duplicate messages, modifying messages, or adding in the history of another event ,etc)
 *
 *      Example of what can be wrong without non-sound asynchronous calls:
 *
 *  Step 0: Initial state:
 *   a = 0;
 *   b = 0;
 *
 *  Step 1: Initial operations:
 *   a = 1;
 *   b = -1;
 *
 *  // an observer reacts to changes in a and b and compute CORRECT like this:
 *   if( a + b == 0) {
 *       CORRECT = false;
 *       notify(...); // act or send a notification somewhere..
 *   } else {
 *      CORRECT = false;
 *   }
 *
 *    Notice that: CORRECT will be true in the end , but meantime, after a notification was sent and CORRECT was wrongly, temporarily false!
 *    soundPubSub guarantee that this does not happen because the syncronous call will before any observer (bot asignation on a and b)
 *
 *   More:
 *   you can use blockCallBacks and releaseCallBacks in a function that change a lot a collection or bindable objects and all
 *   the notifications will be sent compacted and properly
 */

// TODO: optimisation!? use a more efficient queue instead of arrays with push and shift!?
// TODO: see how big those queues can be in real applications
// for a few hundreds items, queues made from array should be enough
//*   Potential TODOs:
//    *     prevent any form of problem by calling callbacks in the expected order !?
//*     preventing infinite loops execution cause by events!?
//*
//*
// TODO: detect infinite loops (or very deep propagation) It is possible!?

const Queue = require('queue');

function SoundPubSub() {

    let subscriberCbkRefHandler = new SubscriberCallbackReferenceHandler();

    /**
     * publish
     *      Publish a message {Object} to a list of subscribers on a specific topic
     *
     * @params {String|Number} target,  {Object} message
     * @return number of channel subscribers that will be notified
     */
    this.publish = function (target, message) {
        if (!invalidChannelName(target) && !invalidMessageType(message) && (typeof channelSubscribers[target] != 'undefined')) {
            compactAndStore(target, message);
            setTimeout(dispatchNext, 0);
            return channelSubscribers[target].length;
        } else {
            return null;
        }
    };

    /**
     * subscribe
     *      Subscribe / add a {Function} callBack on a {String|Number}target channel subscribers list in order to receive
     *      messages published if the conditions defined by {Function}waitForMore and {Function}filter are passed.
     *
     * @params {String|Number}target, {Function}callBack, {Function}waitForMore, {Function}filter
     *
     *          target      - channel name to subscribe
     *          callback    - function to be called when a message was published on the channel
     *          waitForMore - a intermediary function that will be called after a successfuly message delivery in order
     *                          to decide if a new messages is expected...
     *          filter      - a function that receives the message before invocation of callback function in order to allow
     *                          relevant message before entering in normal callback flow
     * @return
     */
    this.subscribe = function (target, callBack, waitForMore, filter) {
        if (!invalidChannelName(target) && !invalidFunction(callBack)) {
            let subscriber = {"waitForMore": waitForMore, "filter": filter};
            if (typeof channelSubscribers[target] === 'undefined') {
                channelSubscribers[target] = [];
            }
            subscriberCbkRefHandler.setSubscriberCallback(subscriber, target, callBack);
            channelSubscribers[target].push(subscriber);
        }
    };

    /**
     * unsubscribe
     *      Unsubscribe/remove {Function} callBack from the list of subscribers of the {String|Number} target channel
     *
     * @params {String|Number} target, {Function} callBack, {Function} filter
     *
     *          target      - channel name to unsubscribe
     *          callback    - reference of the original function that was used as subscribe
     *          filter      - reference of the original filter function
     * @return
     */
    this.unsubscribe = function (target, callBack, filter) {
        if (!invalidFunction(callBack)) {
            //let gotIt = false;
            if (channelSubscribers[target]) {
                for (let i = 0; i < channelSubscribers[target].length; i++) {
                    let subscriber = channelSubscribers[target][i];
                    let callback = subscriberCbkRefHandler.getSubscriberCallback(subscriber);

                    if (callback === callBack && (typeof filter === 'undefined' || subscriber.filter === filter)) {
                        //gotIt = true;
                        subscriber.forDelete = true;
                        subscriber.callBack = undefined;
                        subscriber.filter = undefined;
                    }
                }
            }
            //not valid always since we introduced WeakRef. A subscriber callback could not exists
            // if(!gotIt){
            // 	console.log("Unable to unsubscribe a callback that was not subscribed!");
            // }
        }
    };

    /**
     * blockCallBacks
     *
     * @params
     * @return
     */
    this.blockCallBacks = function () {
        level++;
    };

    /**
     * releaseCallBacks
     *
     * @params
     * @return
     */
    this.releaseCallBacks = function () {
        level--;
        //hack/optimisation to not fill the stack in extreme cases (many events caused by loops in collections,etc)
        while (level === 0 && dispatchNext(true)) {
            //nothing
        }

        while (level === 0 && callAfterAllEvents()) {
            //nothing
        }
    };

    /**
     * afterAllEvents
     *
     * @params {Function} callback
     *
     *          callback - function that needs to be invoked once all events are delivered
     * @return
     */
    this.afterAllEvents = function (callBack) {
        if (!invalidFunction(callBack)) {
            afterEventsCalls.push(callBack);
        }
        this.blockCallBacks();
        this.releaseCallBacks();
    };

    /**
     * hasChannel
     *
     * @params {String|Number} channel
     *
     *          channel - name of the channel that need to be tested if present
     * @return
     */
    this.hasChannel = function (channel) {
        return !invalidChannelName(channel) && (typeof channelSubscribers[channel] != 'undefined') ? true : false;
    };

    /**
     * addChannel
     *
     * @params {String} channel
     *
     *          channel - name of a channel that needs to be created and added to soundpubsub repository
     * @return
     */
    this.addChannel = function (channel) {
        if (!invalidChannelName(channel) && !this.hasChannel(channel)) {
            channelSubscribers[channel] = [];
        }
    };

    /* ---------------------------------------- protected stuff ---------------------------------------- */
    let self = this;
    // map channelName (object local id) -> array with subscribers
    let channelSubscribers = {};

    // map channelName (object local id) -> queue with waiting messages
    let channelsStorage = {};

    // object
    let typeCompactor = {};

    // channel names
    let executionQueue = new Queue();
    let level = 0;


    /**
     * registerCompactor
     *
     *       An compactor takes a newEvent and and oldEvent and return the one that survives (oldEvent if
     *  it can compact the new one or the newEvent if can't be compacted)
     *
     * @params {String} type, {Function} callBack
     *
     *          type        - channel name to unsubscribe
     *          callBack    - handler function for that specific event type
     * @return
     */
    this.registerCompactor = function (type, callBack) {
        if (!invalidFunction(callBack)) {
            typeCompactor[type] = callBack;
        }
    };

    /**
     * dispatchNext
     *
     * @param fromReleaseCallBacks: hack to prevent too many recursive calls on releaseCallBacks
     * @return {Boolean}
     */
    function dispatchNext(fromReleaseCallBacks) {
        if (level > 0) {
            return false;
        }
        const channelName = executionQueue.front();
        let subscriber;
        if (typeof channelName != 'undefined') {
            self.blockCallBacks();
            try {
                let message;
                if (!channelsStorage[channelName].isEmpty()) {
                    message = channelsStorage[channelName].front();
                }
                if (typeof message === 'undefined') {
                    if (!channelsStorage[channelName].isEmpty()) {
                        console.log("Message is undefined but queue is not empty! " + channelName);
                    }
                    executionQueue.pop();
                } else {
                    if (typeof message.__transmisionIndex == 'undefined') {
                        message.__transmisionIndex = 0;
                        for (let i = channelSubscribers[channelName].length - 1; i >= 0; i--) {
                            subscriber = channelSubscribers[channelName][i];
                            if (subscriber.forDelete === true) {
                                channelSubscribers[channelName].splice(i, 1);
                            }
                        }
                    } else {
                        message.__transmisionIndex++;
                    }
                    //TODO: for immutable objects it will not work also, fix for shape models
                    if (typeof message.__transmisionIndex == 'undefined') {
                        console.log("Can't use as message in a pub/sub channel this object: " + message);
                    }
                    subscriber = channelSubscribers[channelName][message.__transmisionIndex];
                    if (typeof subscriber == 'undefined') {
                        delete message.__transmisionIndex;
                        channelsStorage[channelName].pop();
                    } else {
                        if (subscriber.filter === null || typeof subscriber.filter === "undefined" || (!invalidFunction(subscriber.filter) && subscriber.filter(message))) {
                            if (!subscriber.forDelete) {
                                let callback = subscriberCbkRefHandler.getSubscriberCallback(subscriber);
                                if (typeof callback === "undefined") {
                                    subscriber.forDelete = true;
                                } else {
                                    callback(message);
                                    if (subscriber.waitForMore && !invalidFunction(subscriber.waitForMore) && !subscriber.waitForMore(message)) {
                                        subscriber.forDelete = true;
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                console.log("Event callback failed: " + subscriber.callBack + "error: " + err.stack);
            }
            //
            if (fromReleaseCallBacks) {
                level--;
            } else {
                self.releaseCallBacks();
            }
            return true;
        } else {
            return false;
        }
    }

    function compactAndStore(target, message) {
        let gotCompacted = false;
        let arr = channelsStorage[target];
        if (typeof arr == 'undefined') {
            arr = new Queue();
            channelsStorage[target] = arr;
        }

        if (message && typeof message.type != 'undefined') {
            let typeCompactorCallBack = typeCompactor[message.type];

            if (typeof typeCompactorCallBack != 'undefined') {
                for (let channel of arr) {
                    if (typeCompactorCallBack(message, channel) === channel) {
                        if (typeof channel.__transmisionIndex == 'undefined') {
                            gotCompacted = true;
                            break;
                        }
                    }
                }
            }
        }

        if (!gotCompacted && message) {
            arr.push(message);
            executionQueue.push(target);
        }
    }

    let afterEventsCalls = new Queue();

    function callAfterAllEvents() {
        if (!afterEventsCalls.isEmpty()) {
            let callBack = afterEventsCalls.pop();
            //do not catch exceptions here..
            callBack();
        }
        return !afterEventsCalls.isEmpty();
    }

    function invalidChannelName(name) {
        let result = false;
        if (!name || (typeof name != "string" && typeof name != "number")) {
            result = true;
            console.log("Invalid channel name: " + name);
        }

        return result;
    }

    function invalidMessageType(message) {
        let result = false;
        if (!message || typeof message != "object") {
            result = true;
            console.log("Invalid messages types: " + message);
        }
        return result;
    }

    function invalidFunction(callback) {
        let result = false;
        if (!callback || typeof callback != "function") {
            result = true;
            console.log("Expected to be function but is: " + callback);
        }
        return result;
    }

    //weak references are not supported by all browsers
    function SubscriberCallbackReferenceHandler() {
        let finalizationRegistry;
        let hasWeakReferenceSupport = weakReferencesAreSupported();


        if (hasWeakReferenceSupport) {
            finalizationRegistry = new FinalizationRegistry(() => {
                //console.log(`Cleanup ${heldValue}`);
            });
        }

        this.setSubscriberCallback = function (subscriber, target, callback) {
            if (hasWeakReferenceSupport) {
                subscriber.callBack = new WeakRef(callback);
                finalizationRegistry.register(subscriber.callBack, target);
            } else {
                subscriber.callBack = callback;
            }
        }

        this.getSubscriberCallback = function (subscriber) {
            if (hasWeakReferenceSupport) {
                if (subscriber.callBack) {
                    return subscriber.callBack.deref();
                }
                return undefined;

            }
            return subscriber.callBack;
        }

        function weakReferencesAreSupported() {
            return typeof FinalizationRegistry === "function" && typeof WeakRef === "function";
        }
    }


}

exports.soundPubSub = new SoundPubSub();

# soundpubsub

Usually an event could cause execution of other callback events . We say that is a level 1 event if is causeed by a
level 0 event and soon

SoundPubSub provides intuitive results regarding to asynchronous calls of callbacks and computed values/expressions:
we prevent immediate execution of event callbacks to ensure the intuitive final result is guaranteed as level 0
execution
we guarantee that any callback function is "re-entrant"
we are also trying to reduce the number of callback execution by looking in queues at new messages published by
trying to compact those messages (removing duplicate messages, modifying messages, or adding in the history of another
event ,etc)

Example of what can be wrong without non-sound asynchronous calls:

Step 0: Initial state:
a = 0;
b = 0;

Step 1: Initial operations:
a = 1;
b = -1;

// an observer reacts to changes in a and b and compute CORRECT like this:
if( a + b == 0) {
CORRECT = false;
notify(...); // act or send a notification somewhere..
} else {
CORRECT = false;
}

Notice that: CORRECT will be true in the end , but meantime, after a notification was sent and CORRECT was wrongly,
temporarily false!
soundPubSub guarantee that this does not happen because the syncronous call will before any observer (bot asignation on
a and b)

More:
you can use blockCallBacks and releaseCallBacks in a function that change a lot a collection or bindable objects and all
the notifications will be sent compacted and properly

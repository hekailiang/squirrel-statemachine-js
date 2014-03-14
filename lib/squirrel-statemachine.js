/*global require, exports, define, console*/
/*jslint nomen: true, ass: true, vars: true, plusplus:true*/
(function(root, factory) {
  'use strict';
  // Set up Squirrel appropriately for the environment. Start with AMD.
  if (typeof define === 'function' && define.amd) {
    define(['exports', 'lodash'], function(exports, _) {
      // Export global even in AMD case in case this script is loaded with
      // others that may still expect a global Squirrel.
      root.Squirrel = factory(exports, _);
    });

    // Next for Node.js or CommonJS.
  } else if (exports !== undefined) {
    var _ = require('lodash');
    factory(exports, _);

    // Finally, as a browser global.
  } else {
    root.Squirrel = factory({}, root._);
  }

} (this, function(Squirrel, _) {
  'use strict';

  // Create local references to array methods we'll want to use later.
  var array = [];
  // var push = array.push;
  var slice = array.slice;
  // var splice = array.splice;

  // Helpers
  // -------

  // Helper function to correctly set up the prototype chain, for subclasses.
  // Similar to `goog.inherits`, but uses a hash of prototype properties and
  // class properties to be extended.
  function classExtend(protoProps, staticProps) {
    var parent = this;
    var child;

    // The constructor function for the new subclass is either defined by you
    // (the "constructor" property in your `extend` definition), or defaulted
    // by us to simply call the parent's constructor.
    if (protoProps && _.has(protoProps, 'constructor')) {
      child = protoProps.constructor;
    } else {
      child = function(){ return parent.apply(this, arguments); };
    }

    // Add static properties to the constructor function, if supplied.
    _.extend(child, parent, staticProps);

    // Set the prototype chain to inherit from `parent`, without calling
    // `parent`'s constructor function.
    var Surrogate = function(){ this.constructor = child; };
    Surrogate.prototype = parent.prototype;
    child.prototype = new Surrogate();

    // Add prototype properties (instance properties) to the subclass,
    // if supplied.
    if (protoProps) {
      _.extend(child.prototype, protoProps);
    }

    // Set a convenience property in case the parent's prototype is needed
    // later.
    child.__super__ = parent.prototype;

    return child;
  }

  function dynamicSort(property) {
    var sortOrder = 1;
    if(property[0] === "-") {
        sortOrder = -1;
        property = property.substr(1);
    }
    return function (a,b) {
        var result = (a[property] < b[property]) ? -1 : (a[property] > b[property]) ? 1 : 0;
        return result * sortOrder;
    };
  }

  function invokeActions(actions, stateContext) {
    actions.forEach(function(action) {
      action.func.call(stateContext.stateMachine, //->this
        stateContext.from, stateContext.to, stateContext.event, stateContext.context);
    });
  }

  var HistoryType = Squirrel.HistoryType = {
    NONE : 0,
    SHALLOW : 1,
    DEEP : 2
  };

  var StateCompositeType = Squirrel.StateCompositeType = {
    NONE : 0,
    SEQUENTIAL : 1,
    PARALLEL : 2
  };

  var Priority = Squirrel.Priority = {
    HIGH : 100,
    NORMAL : 10,
    LOW: 1
  };

  var TransitionType = Squirrel.TransitionType = {
    INTERNAL : 0,
    LOCAL : 1,
    EXTERNAL : 2
  };

  var Conditions = Squirrel.Conditions = (function() {
    var always = function() {
      return true;
    },

    never = function() {
      return true;
    };

    return {
      Always : always,
      Never : never
    };
  }());

  var TransitionResult = {
    SUCCESS : 0,
    FAILED : 1,
    DECLINED : 2
  };

  var StateMachineStatus = Squirrel.StateMachineStatus = {
    ERROR : -2,
    TERMINATED : -1,
    INITIALIZED : 0,
    IDLE : 1,
    BUSY : 2
  };

  var prioritySorter = dynamicSort("-priority");

  // state machine internal used state class
  var State = function(stateId) {
    this.stateId = stateId;
    this.entryActions = [];
    this.exitActions = [];
    this.transitionMap = {};
    this.parent = undefined;
    this.childStates = undefined;
    this.historyType = HistoryType.NONE;
    this.compositionType = StateCompositeType.NONE;
    this.level = 0;
    this.isFinal = false;
    this.isInitial = false;
    this.isFinalized = false;
  };

  function getState(stateId, states) {
    if(stateId === undefined) {
      throw new Error("stateId cannot be undefined.");
    }

    var result;
    if("object" === typeof states) {
      result = (states[stateId] === undefined) ?
        (states[stateId] = new State(stateId)) : states[stateId];
    }
    return result;
  }

  _.extend(State.prototype, {

    internalFire : function(stateContext) {
      var transitions = this.transitionMap[stateContext.event],
        stateMachine = stateContext.stateMachine;
      _.forEach(transitions, function(transition) {
        var targetRawState, finishEvent;
        transition.internalFire(stateContext);
        if(stateContext.result === TransitionResult.SUCCESS) {
          targetRawState = stateMachine._rawState(stateContext.to);
          if(targetRawState.isFinalState() && !targetRawState.isRootState()) {
            finishEvent = stateMachine.getOptionValue("finishEvent");
            stateMachine.fire(finishEvent, stateContext.context);
          }
          return false;
        }
      });

      // check result
      if(stateContext.result === TransitionResult.DECLINED && this.parent) {
        this.parent.internalFire(stateContext);
      }
    },

    entry : function(stateContext) {
      invokeActions(this.entryActions, stateContext);
    },

    exit : function(stateContext) {
      if(this.isFinal) {
        return;
      }
      invokeActions(this.exitActions, stateContext);
      // update historical state
      if(this.parent && this.parent.getHistoryType()!==HistoryType.NONE) {
        stateContext.stateMachine.setLastActiveChildStateFor(this.parent.stateId, this.stateId);
      }
    },

    addChildState : function(childState) {
      this._check();
      if(childState) {
        if(!this.childStates) {
          this.childStates = [];
        }
        if(!_.contains(this.childStates, childState)) {
          this.childStates.push(childState);
        }
      }
    },

    setParent : function(parent) {
      this._check();
      if(!parent) {
        throw new Error("parent state cannot be state itself.");
      }
      if(!this.parentState) {
        this.parentState = parent;
        this.level = this.parentState ? this.parentState.getLevel()+1 : 1;
      } else {
        throw new Error("Cannot change state parent.");
      }
    },

    finalized : function() {
      this._check();
      this.isFinalized = true;
      this.entryActions.sort(prioritySorter);
      this.exitActions.sort(prioritySorter);
      _.forOwn(this.transitionMap, function(transitions) {
        transitions.sort(prioritySorter);
      });
    },

    addStateActions : function(actions, isEntry) {
      this._check();
      if(_.isArray(actions)) {
        _.forEach(actions, function(action) {
          if(isEntry) {
            this.entryActions.push(action);
          } else {
            this.exitActions.push(action);
          }
        }.bind(this));
      } else {
        throw new Error("Unsupported state action "+actions+".");
      }
    },

    addTransition : function(on, transition) {
      this._check();
      var transitions = this.transitionMap[on];
      if(transitions === undefined) {
        transitions = this.transitionMap[on]=[];
      }
      // validate transitions check no duplicate
      transitions.push(transition);
    },

    getParent : function() {
      return this.parent;
    },

    isFinalState : function() {
      return this.isFinal;
    },

    setFinalSate : function(isFinalState) {
      this.isFinal = isFinalState;
    },

    isRootState : function() {
      return !this.parent;
    },

    getLevel : function() {
      return this.level;
    },

    setLevel : function(level) {
      this._check();
      this.level = level;
      if(this.childStates) {
        _.forEach(this.childStates, function(state) {
          state.setLevel(this.level+1);
        });
      }
    },

    _check : function() {
      if(this.isFinalized) {
        throw new Error("State cannot be changed after it finalized.");
      }
    },

    getPath : function() {
      var currentId = this.stateId.toString();
      return (this.parent) ? this.parent.getPath() + "/" + currentId : currentId;
    },

    hasChildStates : function() {
      return !!this.childStates && this.childStates.length>0;
    },

    enterByHistory : function(stateContext) {
      if(this.isFinal) {
        return this;
      }
      var result;
      switch(this.historyType) {
        case HistoryType.NONE:
          result = this._enterHistoryNone(stateContext);
          break;
        case HistoryType.SHALLOW:
          result = this._enterHistoryShallow(stateContext);
          break;
        case HistoryType.DEEP:
          result = this._enterHistoryDeep(stateContext);
          break;
        default:
          throw new Error("Unsupported historical type.");
      }
      return result;
    },

    getLastActiveChildStateOf : function(stateMachine, rawState) {
      var childStateId = stateMachine.getLastActiveChildStateOf(rawState.stateId);
      return childStateId ? stateMachine._rawState(childStateId) :
        this.getInitialStateOfChildStates();
    },

    _enterDeep : function(stateContext) {
      this.entry(stateContext);
      var lastActiveChildState = this.getLastActiveChildStateOf(stateContext.stateMachine, this);
      return lastActiveChildState ? this : lastActiveChildState._enterDeep(stateContext);
    },

    _enterShallow : function(stateContext) {
      this.entry(stateContext);
      var childInitialState = this.getInitialStateOfChildStates();
      return childInitialState ? childInitialState._enterShallow(stateContext) : this;
    },

    _enterHistoryNone : function(stateContext) {
      var childInitialState = this.getInitialStateOfChildStates();
      return childInitialState ? childInitialState._enterShallow(stateContext) : this;
    },

    _enterHistoryShallow : function(stateContext) {
      var lastActiveState = this.getLastActiveChildStateOf(stateContext.stateMachine, this);
      return lastActiveState ? lastActiveState._enterShallow(stateContext) : this;
    },

    _enterHistoryDeep : function(stateContext) {
      var lastActiveState = this.getLastActiveChildStateOf(stateContext.stateMachine, this);
      return lastActiveState ? lastActiveState._enterDeep(stateContext) : this;
    },

    isInitialState : function() {
      return this.isInitial;
    },

    setInitialState : function(isInitialState) {
      this.isInitial = isInitialState;
    },

    getInitialStateOfChildStates : function() {
      var isFound = _.find(this.childStates || [], function(childState) {
        return childState.isInitial;
      });
      if(!isFound && this.childStates && this.childStates.length>0) {
        isFound = this.childStates[0];
      }
      return isFound;
    },

    getStateId : function() {
      return this.stateId;
    }

  });

  // state machine internal used transition class
  var Transition = function(sourceState, targetState, event, condition, priority, transitionType) {
    this.sourceState = sourceState;
    this.targetState = targetState;
    this.event = event;
    this.actions = [];
    this.condition = condition || Conditions.Always;
    this.priority = priority || Priority.NORMAL;
    this.transitionType = transitionType || TransitionType.EXTERNAL;
    this.isFinalized = false;
  };

  _.extend(Transition.prototype, {
    internalFire : function(stateContext) {
      if(this.condition(stateContext.context)) {
        var newState = stateContext.from, historicalState;
        if(this.transitionType === TransitionType.INTERNAL) {
          this._transit(stateContext);
        } else {
          this._unwindSubStates(this.sourceState, stateContext);
          this._doTransit(this.sourceState, this.targetState, stateContext);
          historicalState = this.targetState.enterByHistory(stateContext);
          newState = historicalState.getStateId();
        }
        stateContext.to = newState;
        stateContext.result = TransitionResult.SUCCESS;
      }
    },

    finalized : function() {
      this._check();
      this.isFinalized = true;
      this.actions.sort(prioritySorter);
    },

    addTransitionActions : function(transitionActions) {
      this._check();
      if(_.isArray(transitionActions)) {
        _.forEach(transitionActions, function(action) {
          this.actions.push(action);
        }.bind(this));
      } else {
        throw new Error("Unsupported transition action"+transitionActions+".");
      }
    },

    getPriority : function() {
      return this.priority;
    },

    _unwindSubStates : function(origin, stateContext) {
      var state;
      for(state=origin; state!==this.sourceState; state=state.getParent()) {
        if(state) {
          state.eixt(stateContext);
        }
      }
    },

    _doTransit : function(source, target, stateContext) {
      if(source.getLevel() < target.getLevel() && this.type === TransitionType.EXTERNAL) {
        // exit and re-enter current state for external transition to child state
        source.exit(stateContext);
        source.entry(stateContext);
      }
      this._doTransitInternal(source, target, stateContext);
    },

    _transit : function(stateContext) {
      invokeActions(this.actions, stateContext);
    },

    /**
     * Recursively traverses the state hierarchy, exiting states along the way, performing the action, and entering states to the target.
     * <hr>
     * There exist the following transition scenarios:
     * <ul>
     * <li>0. there is no target state (internal transition) --> handled outside this method.</li>
     * <li>1. The source and target state are the same (self transition) --> perform the transition directly: Exit source state, perform
     * transition actions and enter target state</li>
     * <li>2. The target state is a direct or indirect sub-state of the source state --> perform the transition actions, then traverse the
     * hierarchy from the source state down to the target state, entering each state along the way. No state is exited.
     * <li>3. The source state is a sub-state of the target state --> traverse the hierarchy from the source up to the target, exiting each
     * state along the way. Then perform transition actions. Finally enter the target state.</li>
     * <li>4. The source and target state share the same super-state</li>
     * <li>5. All other scenarios:
     * <ul>
     * <li>a. The source and target states reside at the same level in the hierarchy but do not share the same direct super-state</li>
     * <li>b. The source state is lower in the hierarchy than the target state</li>
     * <li>c. The target state is lower in the hierarchy than the source state</li>
     * </ul>
     * </ul>
     * 
     * @param source the source state
     * @param target the target state
     * @param stateContext the state context
     */
    _doTransitInternal : function(source, target, stateContext) {
      if(source === this.targetState) {
        // Handles 1.
        // Handles 3. after traversing from the source to the target.
        if(this.type===TransitionType.LOCAL) {
          this._transit(stateContext);
        } else {
          source.exit(stateContext);
          this._transit(stateContext);
          this.targetState.entry(stateContext);
        }
      } else if (source === target) {
        // Handles 2. after traversing from the target to the source.
        this._transit(stateContext);
      } else if(source.getParent() === target.getParent()) {
        // Handles 4.
        // Handles 5a. after traversing the hierarchy until a common ancestor if found.
        source.exit(stateContext);
        this._transit(stateContext);
        target.entry(stateContext);
      } else {
        // traverses the hierarchy until one of the above scenarios is met.
        if(source.getLevel() > target.getLevel()) {
          // Handles 3.
          // Handles 5b.
          source.exit(stateContext);
          this._doTransitInternal(source.getParentState(), target, stateContext);
        } else if(source.getLevel() < target.getLevel()) {
          // Handles 2.
          // Handles 5c.
          this._doTransitInternal(source, target.getParentState(), stateContext);
          target.entry(stateContext);
        } else {
          // Handles 5a.
          source.exit(stateContext);
          this._doTransitInternal(source.getParentState(), target.getParentState(), stateContext);
          target.entry(stateContext);
        }
      }
    },

    _check : function() {
      if(this.isFinalized) {
        throw new Error("State cannot be changed after it finalized.");
      }
    }
  });

  // Copy from Backbone.Events
  // ---------------

  // Regular expression used to split event strings.
  var eventSplitter = /\s+/;

  // Implement fancy features of the Events API such as multiple event
  // names `"change blur"` and jQuery-style event maps `{change: action}`
  // in terms of the existing API.
  var eventsApi = function(obj, action, name, rest) {
    if (!name) {
      return true;
    }

    // Handle event maps.
    var key;
    if (typeof name === 'object') {
      for (key in name) {
        if(name.hasOwnProperty(key)) {
          obj[action].apply(obj, [key, name[key]].concat(rest));
        }
      }
      return false;
    }

    // Handle space separated event names.
    if (eventSplitter.test(name)) {
      var names = name.split(eventSplitter), i, l;
      for (i = 0, l = names.length; i < l; i++) {
        obj[action].apply(obj, [names[i]].concat(rest));
      }
      return false;
    }

    return true;
  };

  // A difficult-to-believe, but optimized internal dispatch function for
  // triggering events. Tries to keep the usual cases speedy (most internal
  // Backbone events have 3 arguments).
  var triggerEvents = function(events, args) {
    var ev, i = -1, l = events.length, a1 = args[0], a2 = args[1], a3 = args[2];
    switch (args.length) {
      case 0: while (++i < l) { (ev = events[i]).callback.call(ev.ctx); } return;
      case 1: while (++i < l) { (ev = events[i]).callback.call(ev.ctx, a1); } return;
      case 2: while (++i < l) { (ev = events[i]).callback.call(ev.ctx, a1, a2); } return;
      case 3: while (++i < l) { (ev = events[i]).callback.call(ev.ctx, a1, a2, a3); } return;
      default: while (++i < l) { (ev = events[i]).callback.apply(ev.ctx, args); } return;
    }
  };

  // A module that can be mixed in to *any object* in order to provide it with
  // custom events. You may bind with `on` or remove with `off` callback
  // functions to an event; `trigger`-ing an event fires all callbacks in
  // succession.
  //
  //     var object = {};
  //     _.extend(object, Backbone.Events);
  //     object.on('expand', function(){ alert('expanded'); });
  //     object.trigger('expand');
  //
  var Events = Squirrel.Events = {
    // Bind an event to a `callback` function. Passing `"all"` will bind
    // the callback to all events fired.
    on: function(name, callback, context) {
      if (!eventsApi(this, 'on', name, [callback, context]) || !callback) {
        return this;
      }
      if(this._events === undefined) {
        this._events = {};
      }
      var events = (this._events[name]===undefined) ?
        (this._events[name] = []) : this._events[name];
      events.push({callback: callback, context: context, ctx: context || this});
      return this;
    },

    // Bind an event to only be triggered a single time. After the first time
    // the callback is invoked, it will be removed.
    once: function(name, callback, context) {
      if (!eventsApi(this, 'once', name, [callback, context]) || !callback) {
        return this;
      }
      var self = this;
      var once = _.once(function() {
        self.off(name, once);
        callback.apply(this, arguments);
      });
      once._callback = callback;
      return this.on(name, once, context);
    },

    // Remove one or many callbacks. If `context` is null, removes all
    // callbacks with that function. If `callback` is null, removes all
    // callbacks for the event. If `name` is null, removes all bound
    // callbacks for all events.
    off: function(name, callback, context) {
      var retain, ev, events, names, i, l, j, k;
      if (!this._events || !eventsApi(this, 'off', name, [callback, context])) {
        return this;
      }
      if (!name && !callback && !context) {
        this._events = undefined; //void 0;
        return this;
      }
      names = name ? [name] : _.keys(this._events);
      for (i = 0, l = names.length; i < l; i++) {
        name = names[i];
        events = this._events[name];
        if (events) {
          this._events[name] = retain = [];
          if (callback || context) {
            for (j = 0, k = events.length; j < k; j++) {
              ev = events[j];
              if ((callback && callback !== ev.callback && callback !== ev.callback._callback) ||
                  (context && context !== ev.context)) {
                retain.push(ev);
              }
            }
          }
          if (!retain.length) {
            delete this._events[name];
          }
        }
      }

      return this;
    },

    // Trigger one or many events, firing all bound callbacks. Callbacks are
    // passed the same arguments as `trigger` is, apart from the event name
    // (unless you're listening on `"all"`, which will cause your callback to
    // receive the true name of the event as the first argument).
    trigger: function(name) {
      if (!this._events) {
        return this;
      }
      var args = slice.call(arguments, 1);
      if (!eventsApi(this, 'trigger', name, args)) {
        return this;
      }
      var events = this._events[name];
      var allEvents = this._events.all;
      if (events) {
        triggerEvents(events, args);
      }
      if (allEvents) {
        triggerEvents(allEvents, arguments);
      }
      return this;
    },

    // Tell this object to stop listening to either specific events ... or
    // to every object it's currently listening to.
    stopListening: function(obj, name, callback) {
      var listeningTo = this._listeningTo;
      if (!listeningTo) {
        return this;
      }
      var remove = !name && !callback;
      if (!callback && typeof name === 'object') {
        callback = this;
      }
      if (obj) {
        (listeningTo = {})[obj._listenId] = obj;
      }
      var id;
      for (id in listeningTo) {
        if(listeningTo.hasOwnProperty(id)) {
          obj = listeningTo[id];
          obj.off(name, callback, this);
          if (remove || _.isEmpty(obj._events)) {
            delete this._listeningTo[id];
          }
        }
      }
      return this;
    }
  };

  // Aliases for backwards compatibility.
  Events.bind   = Events.on;
  Events.unbind = Events.off;
  // Events names
  Events.TRANSITION_BEGIN = "beforeTransitionBegin";
  Events.TRANSITION_COMPLETE = "afterTransitionCompleted";
  Events.TRANSITION_END = "afterTransitionEnd";
  Events.TRANSITION_DECLINED = "afterTransitionDeclined";
  Events.TRANSITION_EXCEPTION = "afterTransitionCausedException";
  Events.STATEMACHINE_START = "afterStateMachineStarted";
  Events.STATEMACHINE_TERMINATE = "afterStateMachineTerminated";

  var defaultOptions = {
    isAutoStartEnabled : true,
    isAutoTerminateEnabled : true,
    isDebugInfoEnabled : false,
    startEvent : "$Start",
    terminateEvent : "$Terminate",
    finishEvent : "$Finish"
  };

  var StateMachine = Squirrel.StateMachine = function(initialState, options) {
    var initialRawState;
    this.initialState = initialState || this.definition.initial;
    if(!this.initialState) {
      initialRawState = _.find(this._states, function(s) { return s.isInitialState(); });
      if(initialRawState) { this.initialState = initialRawState.getStateId(); }
    }
    if(!this.isValidState(this.initialState)) {
      throw new Error("Invalid initial state '"+initialState+"'.");
    }
    this.currentState = null;
    this.options = _.defaults((options || {}), defaultOptions);
    this.status = StateMachineStatus.INITIALIZED;
    this.queuedEvents = [];
    this.lastException = null;
    this.initialize.apply(this, arguments);
  };

  StateMachine.defaultOptions = defaultOptions;

  _.extend(StateMachine.prototype, Events, {
    _states : {},
    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize : function() {
      console.log("default initialize function was called.");
    },

    start : function(context) {
      if(this.status > StateMachineStatus.INITIALIZED) {
        // already started
        return;
      }

      var initialRawState = this._states[this.initialState],
      stateContext = {
        from : null,
        to : this.initialState,
        event : this.options.startEvent,
        context : context,
        stateMachine : this
      }, historyState;
      this._entryAll(initialRawState, stateContext);
      historyState = initialRawState.enterByHistory(stateContext);
      this.currentState = historyState.getStateId();
      this.status = StateMachineStatus.IDLE;
      this.trigger(Events.STATEMACHINE_START, this);
      this._processEvents();
    },

    terminate : function(context) {
      if(this.status === StateMachineStatus.TERMINATED) {
        return;
      }

      var stateContext = {
          from : this.currentState,
          to : null,
          event : this.options.terminateEvent,
          context : context,
          stateMachine : this
        };
      this._exitAll(this._currentRawState(), stateContext);
      this.status = StateMachineStatus.TERMINATED;
      this.trigger(Events.STATEMACHINE_TERMINATE, this);
    },

    fire : function(event, context) {
      if(this.status < StateMachineStatus.INITIALIZED) {
        throw new Error("State machine cannot handle any event in current status");
      } else if(this.status === StateMachineStatus.INITIALIZED) {
        if(this.options.isAutoStartEnabled) {
          this.start(context);
        } else {
          throw new Error("The state machine is not running.");
        }
      }

      this.queuedEvents.push({event: event, context: context});
      this._processEvents();
    },

    _currentRawState : function() {
      return this._states[this.currentState];
    },

    _rawState : function(stateId) {
      return this._states[stateId];
    },

    _processEvents : function() {
      if(this.status === StateMachineStatus.IDLE) {
        this.status = StateMachineStatus.BUSY;
        try {
          var queuedEvent, currentRawState;
          while(this.queuedEvents.length>0) {
            queuedEvent = this.queuedEvents.shift();
            this._processEvent(queuedEvent.event, queuedEvent.context);
          }

          currentRawState = this._currentRawState();
          if( this.options.isAutoTerminateEnabled && currentRawState.isFinalState() && currentRawState.isRootState() ) {
            this.terminate(queuedEvent.context);
          }
        } finally {
          if(this.status === StateMachineStatus.BUSY) {
            this.status = StateMachineStatus.IDLE;
          }
        }
      }
    },

    _processEvent : function(event, context) {
      var fromStateId = this.currentState, toStateId;
      try {
        this.beforeTransitionBegin(fromStateId, event, context);
        this.trigger(Events.TRANSITION_BEGIN, fromStateId, event, context);

        var rawState = this._currentRawState(),
        stateContext = {
          from : this.currentState,
          to : this.currentState,  // by default the 'to' state is the same as 'from'
          event : event,
          context : context,
          stateMachine : this,
          result : TransitionResult.DECLINED
        };

        rawState.internalFire(stateContext);
        // if return success then update current state
        if(stateContext.result === TransitionResult.SUCCESS) {
          this.currentState = toStateId = stateContext.to;
          this.trigger(Events.TRANSITION_COMPLETE, fromStateId, toStateId, event, context);
          this.afterTransitionCompleted(fromStateId, toStateId, event, context);
        } else {
          this.trigger(Events.TRANSITION_DECLINED, fromStateId, event, context);
          this.afterTransitionDeclined(fromStateId, event, context);
        }
      } catch(exception) {
        this.status = StateMachineStatus.ERROR;
        this.lastException = exception;
        this.trigger(Events.TRANSITION_EXCEPTION, fromStateId, toStateId, event, context, exception);
        this.afterTransitionCausedException(fromStateId, toStateId, event, context);
      } finally {
        this.trigger(Events.TRANSITION_END, fromStateId, toStateId, event, context);
        this.afterTransitionEnd(fromStateId, toStateId, event, context);
      }
    },

    getCurrentState : function() {
      return this.currentState;
    },

    isValidState : function(stateId) {
      return this._states[stateId];
    },

    getStatus : function() {
      return this.status;
    },

    _setLastActiveChildStateFor : function(parentStateId, childStateId) {
      if(!this.lastActiveChildStateStore) {
        this.lastActiveChildStateStore = {};
      }
      this.lastActiveChildStateStore[parentStateId] = childStateId;
    },

    getLastActiveChildStateOf : function(parentStateId) {
      if(this.lastActiveChildStateStore) {
        return this.lastActiveChildStateStore[parentStateId];
      }
      return null;
    },

    getLastException : function() {
      return this.lastException;
    },

    getOptionValue : function(optionKey) {
      return this.options[optionKey];
    },

    _entryAll : function(origin, stateContext) {
      var stack = [], state = origin;
      while (state) {
        stack.push(state);
        state = state.getParent();
      }
      while (stack.length > 0) {
        state = stack.pop();
        state.entry(stateContext);
      }
    },

    _exitAll : function(rawState, stateContext) {
      var currentRawState = rawState;
      while(currentRawState) {
        currentRawState.exit(stateContext);
        currentRawState = currentRawState.getParent();
      }
    },

    beforeTransitionBegin : function(fromStateId, event, context) {
      if(this.options.isDebugInfoEnabled) {
        console.log("Transition from '"+fromStateId+"' on event '"+event+
          "' with context '"+context+"' begin.");
      }
    },

    afterTransitionDeclined : function(fromStateId, event, context) {
      if(this.options.isDebugInfoEnabled) {
        console.log("Transition from '"+fromStateId+"' on event '"+event+
          "' with context '"+context+"' declined.");
      }
    },

    afterTransitionCompleted : function(fromStateId, currentStateId, event, context) {
      if(this.options.isDebugInfoEnabled) {
        console.log("Transition from '"+fromStateId+"' to '"+currentStateId+
          "' on event '"+event+"' with context '"+context+"' completed.");
      }
    },

    afterTransitionCausedException : function(fromStateId, currentStateId, event, context) {
      if(this.options.isDebugInfoEnabled) {
        console.log("Transition from '"+fromStateId+"' to '"+currentStateId+
          "' on event '"+event+"' with context '"+context+"' failed.");
      }
    },

    afterTransitionEnd : function(fromStateId, currentStateId, event, context) {
      if(this.options.isDebugInfoEnabled) {
        console.log("Transition from '"+fromStateId+"' to '"+currentStateId+
          "' on event '"+event+"' with context '"+context+"' end.");
      }
    }
  });

  var Keywords = Squirrel.Keywords = {
    DEFINITION : "definition",
    ON_ENTRY   : "onEntry",
    ON_EXIT    : "onExit",
    FINAL      : "final",
    INITIAL    : "initial",
    FROM       : "from",
    TO         : "to",
    ON         : "on",
    WHEN       : "when",
    PERFORM    : "perform"
  };

  var buildActions = function(actionDesc, stateMachinePrototype) {
    if (actionDesc === undefined) {
      return [];
    }

    var func = null, priority = Priority.NORMAL, actions=[];
    if(_.isFunction(actionDesc)) {
      func = actionDesc;
    } else if(_.isString(actionDesc)) {
      var values = actionDesc.split(":");
      func = stateMachinePrototype[values[0]] || function() {
        console.log( "[Warning]-Cannot find action method '"+
          values[0] + "' on state machine definition." );
      };
      priority = (values.length>1) ? parseInt(values[1], 10) : Priority.NORMAL;
    } else if(_.isPlainObject(actionDesc)) {
      func = actionDesc.func || function() {
        console.log( "[Warning]-Cannot find action defined in object '"+
          actionDesc.toString() + "'." );
      };
      priority = actionDesc.priority || Priority.NORMAL;
    } else if(_.isArray(actionDesc)) {
      _.forEach(actionDesc, function(desc) {
        actions.push(buildActions(desc, stateMachinePrototype));
      });
      actions = _.flatten(actions);
    } else {
      func = function() { console.log("Unsupported action description '"+actionDesc+"'."); };
    }

    if(actions.length === 0) {
      actions.push( {func : func, priority : priority} );
    }
    return actions;
  };

  var _mergeDefinition = function(target, source) {
    var defaultDeep = _.partialRight(_.merge, _.defaults);
    // merge definition attributes, e.g. initial, states, transitions
    if(target.initial === undefined && source.initial !== undefined) {
      target.initial = source.initial;
    }
    if(target.states === undefined) {
      target.states = {};
    }
    _.forOwn(source.states, function(state, key) {
      // merge state attributes, e.g. onEntry, onExit, final
      if(_.has(target.states, key)) {
        if(_.has(state, Keywords.ON_ENTRY)) {
          if(_.has(target.states[key], Keywords.ON_ENTRY)) {
            target.states[key].onEntry = [].concat(target.states[key].onEntry, state.onEntry);
          } else {
            target.states[key].onEntry = state.onEntry;
          }
        }
        if(_.has(state, Keywords.ON_EXIT)) {
          if(_.has(target.states[key], Keywords.ON_EXIT)) {
            target.states[key].onExit = [].concat(target.states[key].onExit, state.onExit);
          } else {
            target.states[key].onExit = state.onExit;
          }
        }
        if(_.has(state, Keywords.FINAL) && !_.has(target.states[key], Keywords.FINAL)) {
          target.states[key].final = !!state.final;
        }
        if(_.has(state, Keywords.INITIAL) && !_.has(target.states[key], Keywords.INITIAL)) {
          target.states[key].initial = !!state.initial;
        }
        // process other state attributes
      } else {
        target.states[key] = _.cloneDeep(state);
      }
    });

    if(target.transitions === undefined) {
      target.transitions = [];
    }

    // merge transitions, forEach transition compare with existed one and merge actions
    defaultDeep(target.transitions, source.transitions);

    return target;
  };

  var computeDefinition = function() {
    var mergedDefinition = {},
    stateMachinePrototype = this.prototype,
    currentStateMachineProto = stateMachinePrototype;
    // merge state machine definition along class chain
    while(currentStateMachineProto !== undefined) {
      if(_.has(currentStateMachineProto, Keywords.DEFINITION)) {
        _mergeDefinition(mergedDefinition, currentStateMachineProto.definition);
      }
      currentStateMachineProto = currentStateMachineProto.constructor.__super__;
    }
    return mergedDefinition;
  };

  StateMachine.getDefinition = computeDefinition;

  var buildStateModel = function(stateInfo, stateId, states, stateMachinePrototype) {
    var stateModel = getState(stateId, states), actions;
    if(_.has(stateInfo, Keywords.ON_ENTRY)) {
      actions = buildActions(stateInfo.onEntry, stateMachinePrototype);
      stateModel.addStateActions(actions, true);
    }
    if(_.has(stateInfo, Keywords.ON_EXIT)) {
      actions = buildActions(stateInfo.onExit, stateMachinePrototype);
      stateModel.addStateActions(actions, false);
    }
    if(_.has(stateInfo, Keywords.FINAL)) {
      stateModel.setFinalSate(!!stateInfo.final);
    }
    if(_.has(stateInfo, Keywords.INITIAL)) {
      stateModel.setInitialState(!!stateInfo.initial);
    }
  };

  var buildTransitionModel = function(transitionInfo, states, stateMachinePrototype) {
    var fromState = getState(transitionInfo.from, states),
      toState = getState(transitionInfo.to, states),
      transition = new Transition(fromState, toState, transitionInfo.on,
        transitionInfo.when, transitionInfo.priority, transitionInfo.transitionType),
      actions = buildActions(transitionInfo.perform, stateMachinePrototype);
    transition.addTransitionActions(actions);
    fromState.addTransition(transitionInfo.on, transition);
  };

  var extend = function(stateMachineProps, staticProps) {
    var stateMachineClass = classExtend.call(this, stateMachineProps, staticProps),
      stateMachinePrototype = stateMachineClass.prototype,
      // merge state machine definition along class chain
      mergedDefinition = computeDefinition.call(stateMachineClass),
      stateInfoList = mergedDefinition.states || {},
      transitionInfoList = mergedDefinition.transitions || [],
      states = stateMachinePrototype._states = {};

    // build state model
    _.forOwn(stateInfoList, function(stateInfo, stateId) {
      buildStateModel(stateInfo, stateId, states, stateMachinePrototype);
    });

    // build transition model
    _.forEach(transitionInfoList, function(transitionInfo) {
      buildTransitionModel(transitionInfo, states, stateMachinePrototype);
    });

    // finalize the state which means cannot be changed anymore, and also perform 
    // some post processing including action sorting and so on.
    _.forEach(states, function(state) {
      state.finalized();
    });

    // assembly conventional action

    return stateMachineClass;
  };

  StateMachine.extend = extend;

  return Squirrel;
}));
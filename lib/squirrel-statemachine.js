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
  } else if (typeof exports !== 'undefined') {
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

  var Weight = {};
  Weight.MAX_WEIGHT    = 1000000;
  Weight.BEFORE_WEIGHT = 1000;
  Weight.NORMAL_WEIGHT = 10;
  Weight.EXTENSION_WEIGHT = 1;
  Weight.AFTER_WEIGHT  = -1 * Weight.BEFORE_WEIGHT;
  Weight.MIN_WEIGHT    = -1 * Weight.MAX_WEIGHT;
  Weight.IGNORE_WEIGHT = Weight.MIN_WEIGHT - 1;

  Squirrel.Weight = Weight;

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

  var Keywords = Squirrel.Keywords = {
    STATEMACHINE    : "machine",
    ON_ENTRY        : "onEntry",
    ON_EXIT         : "onExit",
    PRIORITY        : "perform",
    FINAL           : "final",
    INITIAL         : "initial",
    FROM            : "from",
    TO              : "to",
    ON              : "on",
    WHEN            : "when",
    PERFORM         : "perform",
    HISTORY_TYPE    : "history",
    CHILDREN        : "children",
    TRANSITION_TYPE : "type",
    STATES          : "states",
    TRANSITIONS     : "transitions",
    FUNCTION        : "func",
    WEIGHT          : "weight"
  };

  var prioritySorter = dynamicSort("-priority");
  var weightSorter = dynamicSort("-weight");

  // state machine internal used state class
  var State = function(stateId) {
    this.stateId = stateId;
    this.entryActions = [];
    this.exitActions = [];
    this.transitionMap = {};
    this.parentState = undefined;
    this.childStates = undefined;
    this.historyType = HistoryType.NONE;
    this.compositionType = StateCompositeType.NONE;
    this.level = 0;
    this.isFinal = false;
    this.isInitial = false;
    this.isFinalized = false;
  };

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
      if(stateContext.result === TransitionResult.DECLINED && this.parentState) {
        this.parentState.internalFire(stateContext);
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
      if(this.parentState && this.parentState.getHistoryType()!==HistoryType.NONE) {
        stateContext.stateMachine._setLastActiveChildStateFor(this.parentState.stateId, this.stateId);
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

    setParentState : function(parent) {
      this._check();
      if(!parent) {
        throw new Error("parent state cannot be state itself.");
      }
      if(!this.parentState) {
        this.parentState = parent;
        this.setLevel(this.parentState ? this.parentState.getLevel()+1 : 1);
      } else {
        throw new Error("Cannot change state parent.");
      }
    },

    getParentState : function() {
      return this.parentState;
    },

    finalized : function() {
      this._check();
      this.isFinalized = true;
      this.entryActions.sort(weightSorter);
      this.exitActions.sort(weightSorter);
      _.forOwn(this.transitionMap, function(transitions) {
        _.forEach(transitions, function(transition) {
          transition.finalized();
        });
        transitions.sort(prioritySorter);
      });
    },

    addStateActions : function(actions, isEntry) {
      this._check();
      if(_.isArray(actions)) {
        _.forEach(actions, function(action) {
          this.addStateAction(action, isEntry);
        }.bind(this));
      } else {
        throw new Error("Unsupported state action "+actions+".");
      }
    },

    addStateAction : function(action, isEntry) {
      this._check();
      if(action.func && _.isFunction(action.func) &&
        action.weight!==undefined && _.isNumber(action.weight)) {
        var actions = isEntry ? this.entryActions : this.exitActions,
        isFound = _.find(actions, function(a) {
          return a.func === action.func;
        });
        // do not allow to add duplicate functions
        if(!isFound) { actions.push(action); }
      } else {
        throw new Error("Illegal format of state action");
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

    isFinalState : function() {
      return this.isFinal;
    },

    setFinalSate : function(isFinalState) {
      this.isFinal = isFinalState;
    },

    isRootState : function() {
      return !this.parentState;
    },

    getLevel : function() {
      return this.level;
    },

    setLevel : function(level) {
      this._check();
      this.level = level;
      if(this.childStates) {
        _.forEach(this.childStates, function(state) {
          state.setLevel(level+1);
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
      return (this.parentState) ? this.parentState.getPath() + "/" + currentId : currentId;
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
        this.getInitialChildState();
    },

    _enterDeep : function(stateContext) {
      this.entry(stateContext);
      var lastActiveChildState = this.getLastActiveChildStateOf(stateContext.stateMachine, this);
      return lastActiveChildState ? lastActiveChildState._enterDeep(stateContext) : this;
    },

    _enterShallow : function(stateContext) {
      this.entry(stateContext);
      var childInitialState = this.getInitialChildState();
      return childInitialState ? childInitialState._enterShallow(stateContext) : this;
    },

    _enterHistoryNone : function(stateContext) {
      var childInitialState = this.getInitialChildState();
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

    getInitialChildState : function() {
      return _.find(this.childStates || [], function(childState) {
        return childState.isInitial;
      });
    },

    getStateId : function() {
      return this.stateId;
    },

    getHistoryType : function() {
      return this.historyType;
    },

    setHistoryType : function(historyType) {
      this.historyType = historyType;
    }

  });

  // state machine internal used transition class
  var Transition = function(sourceState, targetState, event, condition, priority, transitionType) {
    this.sourceState = sourceState;
    this.targetState = (transitionType===TransitionType.INTERNAL) ? sourceState : targetState;
    this.event = event;
    this.actions = [];
    this.condition = condition || Conditions.Always;
    this.priority = priority || Priority.NORMAL;
    this.transitionType = (transitionType===undefined) ? TransitionType.EXTERNAL : transitionType.valueOf();
    this.isFinalized = false;
  };

  _.extend(Transition.prototype, {
    internalFire : function(stateContext) {
      if(this.condition(stateContext.context)) {
        var newState = stateContext.from, historicalState,
          origin = stateContext.stateMachine._rawState(stateContext.from);
        if(this.transitionType === TransitionType.INTERNAL) {
          this._transit(stateContext);
        } else {
          this._unwindSubStates(origin, stateContext);
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
      this.actions.sort(weightSorter);
    },

    addTransitionActions : function(transitionActions) {
      this._check();
      if(_.isArray(transitionActions)) {
        _.forEach(transitionActions, function(action) {
          this.addTransitionAction(action);
        }.bind(this));
      } else {
        throw new Error("Unsupported transition action"+transitionActions+".");
      }
    },

    addTransitionAction : function(transitionAction) {
      this._check();
      if(transitionAction.func && _.isFunction(transitionAction.func) &&
        transitionAction.weight!==undefined && _.isNumber(transitionAction.weight)) {
        var isFound = _.find(this.actions, function(action) {
          return action.func === transitionAction.func;
        });
        // do not allow to add duplicate functions
        if(!isFound) {
          this.actions.push(transitionAction);
        }
      } else {
        throw new Error("Illegal format of transition action");
      }
    },

    getPriority : function() {
      return this.priority;
    },

    _unwindSubStates : function(origin, stateContext) {
      var state;
      for(state=origin; state!==this.sourceState; state=state.getParentState()) {
        if(state) {
          state.exit(stateContext);
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
        if(this.transitionType===TransitionType.LOCAL) {
          this._transit(stateContext);
        } else {
          source.exit(stateContext);
          this._transit(stateContext);
          this.targetState.entry(stateContext);
        }
      } else if (source === target) {
        // Handles 2. after traversing from the target to the source.
        this._transit(stateContext);
      } else if(source.getParentState() === target.getParentState()) {
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

  Squirrel.Options = {
    isAutoStartEnabled : true,
    isAutoTerminateEnabled : true,
    isDebugInfoEnabled : false,
    startEvent : "$Start",
    terminateEvent : "$Terminate",
    finishEvent : "$Finish"
  };

  var StateMachine = Squirrel.StateMachine = function(initialState, options) {
    var initialRawState;
    if(initialState) {
      this.initialState = initialState;
    }
    if(!this.initialState) {
      initialRawState = _.find(this._states, function(s) { return s.isInitialState(); });
      if(initialRawState) { this.initialState = initialRawState.getStateId(); }
    }
    if(!this.isValidState(this.initialState)) {
      throw new Error("Invalid initial state '"+initialState+"'.");
    }
    this.currentState = null;
    this.options = _.defaults((options || {}), Squirrel.Options);
    this.status = StateMachineStatus.INITIALIZED;
    this.queuedEvents = [];
    this.lastException = null;
    this.initialize.apply(this, arguments);
  };

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
        this.transitionBegin(fromStateId, event, context);
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
          this.transitionCompleted(fromStateId, toStateId, event, context);
        } else {
          this.trigger(Events.TRANSITION_DECLINED, fromStateId, event, context);
          this.transitionDeclined(fromStateId, event, context);
        }
      } catch(exception) {
        this.status = StateMachineStatus.ERROR;
        this.lastException = exception;
        this.trigger(Events.TRANSITION_EXCEPTION, fromStateId, toStateId, event, context, exception);
        this.transitionError(fromStateId, toStateId, event, context);
      } finally {
        this.trigger(Events.TRANSITION_END, fromStateId, toStateId, event, context);
        this.transitionEnd(fromStateId, toStateId, event, context);
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
        state = state.getParentState();
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
        currentRawState = currentRawState.getParentState();
      }
    },

    transitionBegin : function(fromStateId, event, context) {
      if(this.options.isDebugInfoEnabled) {
        console.log("Transition from '"+fromStateId+"' on event '"+event+
          "' with context '"+context+"' begin.");
      }
    },

    transitionDeclined : function(fromStateId, event, context) {
      if(this.options.isDebugInfoEnabled) {
        console.log("Transition from '"+fromStateId+"' on event '"+event+
          "' with context '"+context+"' declined.");
      }
    },

    transitionCompleted : function(fromStateId, currentStateId, event, context) {
      if(this.options.isDebugInfoEnabled) {
        console.log("Transition from '"+fromStateId+"' to '"+currentStateId+
          "' on event '"+event+"' with context '"+context+"' completed.");
      }
    },

    transitionError : function(fromStateId, currentStateId, event, context) {
      console.log("Transition from '"+fromStateId+"' to '"+currentStateId+
          "' on event '"+event+"' with context '"+context+"' failed because '"+
          this.getLastException().message+"'.");
      throw this.getLastException();
    },

    transitionEnd : function(fromStateId, currentStateId, event, context) {
      if(this.options.isDebugInfoEnabled) {
        console.log("Transition from '"+fromStateId+"' to '"+currentStateId+
          "' on event '"+event+"' with context '"+context+"' end.");
      }
    },

    methodMissing : function(methodName, fromStateId, toStateId, event, context, stateMachine) {
      if(this.options.isDebugInfoEnabled) {
        console.log("Cannot found method '"+methodName+"' from '"+fromStateId+"' to '"+
          toStateId+"' on '"+event+"' with context '"+context+"'.");
        console.log("State Machine Definition: \n"+stateMachine.getEffectiveDefinition());
      }
    }
  });

  var extend = function(stateMachineProps, staticProps) {
    // ======================================
    // state machine builder helper functions
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

    function buildActions(actionDesc, stateMachinePrototype) {
      if (actionDesc === undefined) {
        return [];
      }

      var func = null, weight = Weight.NORMAL_WEIGHT, actions=[];
      if(_.isFunction(actionDesc)) {
        func = actionDesc;
      } else if(_.isString(actionDesc)) {
        var values = actionDesc.split(":");
        func = stateMachinePrototype[values[0]] ||
          _.partial(stateMachinePrototype.methodMissing, values[0]);
        weight = (values.length>1) ? parseInt(values[1], 10) : Weight.NORMAL_WEIGHT;
      } else if(_.isPlainObject(actionDesc)) {
        func = actionDesc[Keywords.FUNCTION] || function() {
          console.log( "[Warning]-Cannot find action defined in object '"+
            actionDesc.toString() + "'." );
        };
        weight = actionDesc[Keywords.WEIGHT] || Weight.NORMAL_WEIGHT;
      } else if(_.isArray(actionDesc)) {
        _.forEach(actionDesc, function(desc) {
          actions.push(buildActions(desc, stateMachinePrototype));
        });
        actions = _.flatten(actions);
      } else {
        func = function() { console.log("Unsupported action description '"+actionDesc+"'."); };
      }

      if(actions.length === 0) {
        actions.push( {func : func, weight : weight} );
      }
      return actions;
    }

    function buildTransitionModel(transitionInfo, states, stateMachinePrototype) {
      // verify transitionInfo
      if(!transitionInfo[Keywords.FROM]) {
        throw new Error("Transition from state must be defined. (" +transitionInfo+")");
      }
      if(transitionInfo[Keywords.TRANSITION_TYPE] === TransitionType.INTERNAL &&
        transitionInfo[Keywords.TO] && transitionInfo[Keywords.FROM] !== transitionInfo[Keywords.TO]) {
        throw new Error("Internal transition from state and to state must be same. (" +transitionInfo+")");
      }
      var fromState = getState(transitionInfo[Keywords.FROM], states),
        toState = getState(transitionInfo[Keywords.TO], states),
        transition = new Transition( fromState, toState, transitionInfo[Keywords.ON],
          transitionInfo[Keywords.WHEN], transitionInfo[Keywords.PRIORITY],
          transitionInfo[Keywords.TRANSITION_TYPE] ),
        actions = buildActions(transitionInfo[Keywords.PERFORM], stateMachinePrototype);
      transition.addTransitionActions(actions);

      // discover transition extension method if any
      _.forEach([
        "transitFrom"+transitionInfo.from+"To"+transitionInfo.to+"On"+transitionInfo.on,
        "transitFrom"+transitionInfo.from+"ToAny"+"On"+transitionInfo.on,
        "transitFromAnyTo"+transitionInfo.to+"On"+transitionInfo.on,
        "transitFrom"+transitionInfo.from+"To"+transitionInfo.to,
        "transitFromAnyTo"+transitionInfo.to,
        "transitFrom"+transitionInfo.from,
        "on"+transitionInfo.on, "transitAny"
      ], function(funcName) {
        if(stateMachinePrototype[funcName] && _.isFunction(stateMachinePrototype[funcName])) {
          transition.addTransitionAction(
            {func : stateMachinePrototype[funcName],  weight : Weight.EXTENSION_WEIGHT}
          );
        }
      });

      fromState.addTransition(transitionInfo[Keywords.ON], transition);
    }

    function buildStateModel(stateInfo, stateId, states, stateMachinePrototype) {
      var parentStateModel = getState(stateId, states), actions;
      if(_.has(stateInfo, Keywords.ON_ENTRY)) {
        actions = buildActions(stateInfo[Keywords.ON_ENTRY], stateMachinePrototype);
        parentStateModel.addStateActions(actions, true);
      }

      if(_.has(stateInfo, Keywords.ON_EXIT)) {
        actions = buildActions(stateInfo[Keywords.ON_EXIT], stateMachinePrototype);
        parentStateModel.addStateActions(actions, false);
      }
      if(_.has(stateInfo, Keywords.FINAL)) {
        parentStateModel.setFinalSate(!!stateInfo[Keywords.FINAL]);
      }
      if(_.has(stateInfo, Keywords.INITIAL)) {
        parentStateModel.setInitialState(!!stateInfo[Keywords.INITIAL]);
      }
      if(_.has(stateInfo, Keywords.HISTORY_TYPE)) {
        parentStateModel.setHistoryType(stateInfo[Keywords.HISTORY_TYPE]);
      }
      if(_.has(stateInfo, Keywords.CHILDREN) && _.isPlainObject(stateInfo[Keywords.CHILDREN])) {
        _.forOwn(stateInfo[Keywords.CHILDREN], function(childStateInfo, childStateId) {
          var childStateModel = buildStateModel(childStateInfo, childStateId, states, stateMachinePrototype);
          parentStateModel.addChildState(childStateModel);
          childStateModel.setParentState(parentStateModel);
        });
      }

      // discover state extension method if any
      var entryAnyFunc = stateMachinePrototype.entryAny,
        exitAnyFunc = stateMachinePrototype.exitAny;
      if(entryAnyFunc && _.isFunction(entryAnyFunc)) {
        parentStateModel.addStateAction(
          {func: entryAnyFunc, weight: Weight.EXTENSION_WEIGHT}, true);
      }
      if(exitAnyFunc && _.isFunction(exitAnyFunc)) {
        parentStateModel.addStateAction(
          {func: exitAnyFunc, weight: Weight.EXTENSION_WEIGHT}, false);
      }

      return parentStateModel;
    }

    function mergeDefinition(target, source) {
      // merge definition attributes, e.g. initial, states, transitions
      if(source[Keywords.INITIAL] && !target[Keywords.INITIAL]) {
        target[Keywords.INITIAL] = source[Keywords.INITIAL];
      }

      if(!target[Keywords.STATES]) {
        target[Keywords.STATES] = {};
      }
      _.forOwn(source[Keywords.STATES], function(sourceState, key) {
        // merge state attributes, e.g. onEntry, onExit, final
        if(_.has(target[Keywords.STATES], key)) {
          // array attribute value merge
          _.forEach([Keywords.ON_ENTRY, Keywords.ON_EXIT], function(keyword) {
            var targetState = target[Keywords.STATES][key];
            if(_.has(sourceState, keyword)) {
              if(_.has(targetState, keyword)) {
                targetState[keyword] = [].concat(targetState[keyword], sourceState[keyword]); // _.flattern
              } else {
                targetState[keyword] = sourceState[keyword];
              }
            }
          });

          // single attribute value merge
          _.forEach([Keywords.FINAL, Keywords.INITIAL, Keywords.HistoryType], function(keyword) {
            var targetState = target[Keywords.STATES][key];
            if(_.has(sourceState, keyword) && !_.has(targetState, keyword)) {
              targetState[keyword] = sourceState[keyword];
            }
          });

          // process other state attributes
        } else {
          target[Keywords.STATES][key] = _.cloneDeep(sourceState);
        }
      });

      if(!target[Keywords.TRANSITIONS]) {
        target[Keywords.TRANSITIONS] = [];
      }
      _.forEach(source[Keywords.TRANSITIONS], function(sourceTransition) {
        var matchedTargetTransition =
          _.find(target[Keywords.TRANSITIONS], function(targetTransition) {
            return (
              (targetTransition[Keywords.FROM]===sourceTransition[Keywords.FROM]) &&
              (targetTransition[Keywords.TO]===sourceTransition[Keywords.TO]) &&
              (targetTransition[Keywords.ON]===sourceTransition[Keywords.ON]) &&
              (targetTransition[Keywords.WHEN]===sourceTransition[Keywords.WHEN])
            );
          });
        if(matchedTargetTransition) {
          // merge transition action
          matchedTargetTransition[Keywords.PERFORM] =
            [].concat(matchedTargetTransition[Keywords.PERFORM], sourceTransition[Keywords.PERFORM]);
        } else {
          target[Keywords.TRANSITIONS].push(_.cloneDeep(sourceTransition));
        }
      });

      return target;
    }

    function computeDefinition(stateMachine) {
      var mergedDefinition = {},
      stateMachinePrototype = _.isFunction(stateMachine) ? stateMachine.prototype :
        (_.isObject(stateMachine) ? stateMachine.constructor.prototype : undefined),
      currentStateMachineProto = stateMachinePrototype;
      // merge state machine definition along class chain
      while(currentStateMachineProto) {
        if(_.has(currentStateMachineProto, Keywords.STATEMACHINE)) {
          mergeDefinition(mergedDefinition, currentStateMachineProto[Keywords.STATEMACHINE]);
        }
        currentStateMachineProto = currentStateMachineProto.constructor.__super__;
      }
      return mergedDefinition;
    }
    // ======================================

    // build state machine model
    var stateMachineClass = classExtend.call(this, stateMachineProps, staticProps),
      stateMachinePrototype = stateMachineClass.prototype,
      // merge state machine definition along class chain
      mergedDefinition = computeDefinition(stateMachineClass),
      stateInfoList = mergedDefinition[Keywords.STATES] || {},
      transitionInfoList = mergedDefinition[Keywords.TRANSITIONS] || [],
      states = stateMachinePrototype._states = {};

    if(Squirrel.Options.isDebugInfoEnabled) {
      console.log(
        JSON.stringify(mergedDefinition, function(key, val) {
          return _.isFunction(val) ? val + " " : val;
        }, 2)
      );
    }

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

    if(mergedDefinition.initial!==undefined) {
      stateMachinePrototype.initialState = mergedDefinition.initial;
    }
    return stateMachineClass;
  };

  StateMachine.extend = extend;

  return Squirrel;
}));
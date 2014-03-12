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
  // helper functions
  function invokeActions(actions, stateContext) {
    actions.forEach(function(action) {
      action.func.call(stateContext.stateMachine, //->this
        stateContext.from, stateContext.to, stateContext.event, stateContext.context);
    });
  }

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

  // state machine internal used state class
  var State = function(stateId) {
    this.stateId = stateId;
    this.entryActions = [];
    this.exitActions = [];
    this.transitionMap = {};
    this.parent = null;
    this.childStates = [];
    this.historyType = HistoryType.NONE;
    this.compositionType = StateCompositeType.NONE;
    this.level = 0;
    this.isFinal = false;
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
      var transitions = this.transitionMap[stateContext.event], i, transition;
      for(i=0; i<transitions.length; ++i) {
        transition = transitions[i];
        transition.internalFire(stateContext);
        // check result
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
    },

    addChildState : function() {

    },

    finalize : function() {

    },

    addStateActions : function(actions, isEntry) {
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

    isRootState : function() {
      return this.parent === null;
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
  };

  _.extend(Transition.prototype, {
    internalFire : function(stateContext) {
      if(this.condition(stateContext.context)) {
        if(this.transitionType === TransitionType.INTERNAL) {
          invokeActions(this.actions, stateContext);
        } else {
          this.sourceState.exit(stateContext);
          invokeActions(this.actions, stateContext);
          this.targetState.entry(stateContext);
        }
        stateContext.to = this.targetState.stateId;
        stateContext.result = TransitionResult.SUCCESS;
      }
    },

    finalize : function() {

    },

    addTransitionActions : function(transitionActions) {
      if(_.isArray(transitionActions)) {
        _.forEach(transitionActions, function(action) {
          this.actions.push(action);
        }.bind(this));
      } else {
        throw new Error("Unsupported transition action"+transitionActions+".");
      }
    }

  });

  var Events = {
    on : function() {}
  };

  var defaultOptions = {
    isAutoStartEnabled : true,
    isAutoTerminateEnabled : true,
    isDebugInfoEnabled : false
  };

  var StateMachine = Squirrel.StateMachine = function(initialState, options) {
    this.initialState = initialState || this.definition.initial;
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
    initialize : function() {},

    start : function(context) {
      if(this.status > StateMachineStatus.INITIALIZED) {
        // already started
        return;
      }

      var initialRawState = this._states[this.initialState],
      stateContext = {
        from : null,
        to : this.initialState,
        event : null,
        context : context,
        stateMachine : this
      };
      this._entryAll(initialRawState, stateContext);
      initialRawState.entry(stateContext); // enterByHistory
      this.currentState = stateContext.to;
      this.status = StateMachineStatus.IDLE;
    },

    terminate : function(context) {
      if(this.status === StateMachineStatus.TERMINATED) {
        return;
      }

      var stateContext = {
          from : this.currentState,
          to : null, 
          event : null,
          context : context,
          stateMachine : this
        };
      this._exitAll(this._currentRawState(), stateContext);
      this.status = StateMachineStatus.TERMINATED;
      // fire event
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
          this.afterTransitionCompleted(fromStateId, toStateId, event, context);
        }
      } catch(exception) {
        this.status = StateMachineStatus.ERROR;
        this.lastException = exception;
        this.afterTransitionCausedException(fromStateId, toStateId, event, context);
      } finally {
        this.afterTransitionEnd(fromStateId, toStateId, event, context);
      }
    },

    getCurrentState : function() {
      return this.currentState;
    },

    isValidState : function(stateId) {
      return !!this._states[stateId];
    },

    getStatus : function() {
      return this.status;
    },

    getLastException : function() {
      return this.lastException;
    },

    _entryAll : function(rawState, stateContext) {
    },

    _exitAll : function(rawState, stateContext) {
      var currentRawState = rawState;
      while(currentRawState !== null) {
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

  var buildAction = function(actionDesc, stateMachinePrototype) {
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
        actions.push(buildAction(desc, stateMachinePrototype));
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

  var mergeDefinition = function(target, source) {
    var defaultDeep = _.partialRight(_.merge, _.defaults), state;
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
        if(_.has(state, "onEntry")) {
          if(_.has(target.states[key], "onEntry")) {
            target.states[key].onEntry = [].concat(target.states[key].onEntry, state.onEntry);
          } else {
            target.states[key].onEntry = state.onEntry;
          }
        } 
        if(_.has(state, "onExit")) {
          if(_.has(target.states[key], "onExit")) {
            target.states[key].onExit = [].concat(target.states[key].onExit, state.onExit);
          } else {
            target.states[key].onExit = state.onExit;
          }
        }
        if(_.has(state, "final")) {
          target.states[key].final = !!state.final;
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

  var extend = function(stateMachineProps, staticProps) {
    var stateMachineClass = classExtend.call(this, stateMachineProps, staticProps),
      stateMachinePrototype = stateMachineClass.prototype,
      currentStateMachineProto = stateMachinePrototype,
      mergedDefinition = {}, stateInfoList, transitionInfoList,
      stateModel, actions, fromState, toState, transition, 
      states = stateMachinePrototype._states = {};

    // merge state machine definition along class chain
    while(currentStateMachineProto !== undefined) {
      if(currentStateMachineProto.hasOwnProperty("definition")) {
        mergeDefinition(mergedDefinition, currentStateMachineProto.definition);
      }
      currentStateMachineProto = currentStateMachineProto.constructor.__super__;
    }
    stateInfoList = mergedDefinition.states || {};
    transitionInfoList = mergedDefinition.transitions || [];

    // build state model
    _.forOwn(stateInfoList, function(stateInfo, stateId) {
      stateModel = getState(stateId, states);
      if(stateInfo.hasOwnProperty("onEntry")) {
        actions = buildAction(stateInfo.onEntry, stateMachinePrototype);
        stateModel.addStateActions(actions, true);
      }
      if(stateInfo.hasOwnProperty("onExit")) {
        actions = buildAction(stateInfo.onExit, stateMachinePrototype);
        stateModel.addStateActions(actions, false);
      }
      if(stateInfo.hasOwnProperty("final")) {
        stateModel.isFinal = !!stateInfo.final;
      }
    });

    // build transition model
    _.forEach(transitionInfoList, function(transitionInfo) {
      fromState = getState(transitionInfo.from, states);
      toState = getState(transitionInfo.to, states);
      transition = new Transition(fromState, toState, transitionInfo.on, 
        transitionInfo.when, transitionInfo.priority, transitionInfo.transitionType);
      actions = buildAction(transitionInfo.perform, stateMachinePrototype);
      transition.addTransitionActions(actions);
      fromState.addTransition(transitionInfo.on, transition);
    });

    return stateMachineClass;
  };

  StateMachine.extend = extend;

  return Squirrel;
}));
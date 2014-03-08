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
    this.parentState = null;
    this.childStates = [];
    this.historyType = HistoryType.NONE;
    this.compositionType = StateCompositeType.NONE;
    this.level = 0;
  };

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
      invokeActions(this.exitActions, stateContext);
    },

    addChildState : function() {

    },

    finalize : function() {

    },

    addStateAction : function(action, isEntry) {
      if(isEntry) {
        this.entryActions.push(action);
      } else {
        this.exitActions.push(action);
      }
    },

    addTransition : function(on, transition) {
      var transitions = this.transitionMap[on];
      if(transitions === undefined) {
        transitions = this.transitionMap[on]=[];
      }
      // validate transitions check no duplicate
      transitions.push(transition);
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

    }
  });

  var Events = {
    on : function() {}
  };

  var defaultOptions = {
    isAutoStartEnabled : true,
    isAutoTerminateEnabled : true
  };

  var StateMachine = Squirrel.StateMachine = function(initialState, options) {
    this.initialState = initialState || this.definition.initial;
    if(!this.isValidState(this.initialState)) {
      throw new Error("Invalid initial state '"+initialState+"'.");
    }
    this.options = _.defaults((options || {}), defaultOptions);
    this.status = StateMachineStatus.INITIALIZED;
    this.currentState = null;
    this.initialize.apply(this, arguments);
  };

  StateMachine.defaultOptions = defaultOptions;

  _.extend(StateMachine.prototype, Events, {
    _states : {},
    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

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

    },

    fire : function(event, context) {
      if(this.status === StateMachineStatus.INITIALIZED) {
        if(this.options.isAutoStartEnabled) {
          this.start(context);
        } else {
          throw new Error("The state machine is not running.");
        }
      }
      var rawState = this._states[this.currentState],
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
        this.currentState = stateContext.to;
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

    _entryAll : function(rawState, stateContext) {
    },

    beforeTransitionBegin : function() {},
    afterTransitionComplete : function() {}

  });

  var extend = function(stateMachineProps, staticProps) {
    var stateMachineClass = classExtend.call(this, stateMachineProps, staticProps),
      stateMachinePrototype = stateMachineClass.prototype,
      stateInfoList = stateMachinePrototype.definition.states || {},
      transitionInfoList = stateMachinePrototype.definition.transitions || [],
      states = stateMachinePrototype._states, 
      stateId, stateModel, stateInfo, action, 
      transitionInfo, fromState, toState, transition, i;

    var getState = function(stateId) {
      if(stateId===undefined) {
        throw new Error("stateId cannot be undefined.");
      }
      if(states[stateId] === undefined) {
        states[stateId] = new State(stateId);
      }
      return states[stateId];
    };

    var buildAction = function(actionDesc) {
      var actionType = typeof actionDesc, 
          func = null, 
          priority = Priority.NORMAL;
      if("function" === actionType) {
        func = actionDesc;
      } else if("string" === actionType) {
        var values = actionDesc.split(":");
        func = stateMachinePrototype[values[0]] || function() {
          console.log( "[Warning]-Cannot find action method '"+
            values[0] + "' on state machine definition." );
        };
        priority = (values.length>1) ? parseInt(values[1], 10) : Priority.NORMAL;
      } else if("object" === actionType) {
        func = actionDesc.func || function() {
          console.log( "[Warning]-Cannot find action defined in object '"+
            actionDesc.toString() + "'." );
        };
        priority = actionDesc.priority || Priority.NORMAL;
      }
      return {func : func, priority : priority};
    };

    // build state model
    for(stateId in stateInfoList) {
      if (stateInfoList.hasOwnProperty(stateId)) {
        stateModel = getState(stateId);
        stateInfo = stateInfoList[stateId];
        if(stateInfo.hasOwnProperty("onEntry")) {
          action = buildAction(stateInfo.onEntry);
          stateModel.addStateAction(action, true);
        }
        if(stateInfo.hasOwnProperty("onExit")) {
          action = buildAction(stateInfo.onExit);
          stateModel.addStateAction(action, false);
        }
      }
    }

    // build transition model
    for(i=0; i<transitionInfoList.length; ++i) {
      transitionInfo = transitionInfoList[i];
      fromState = getState(transitionInfo.from);
      toState = getState(transitionInfo.to);
      transition = new Transition(fromState, toState, transitionInfo.on, 
        transitionInfo.when, transitionInfo.priority, transitionInfo.transitionType);
      action = buildAction(transitionInfo.perform);
      transition.actions.push(action);
      fromState.addTransition(transitionInfo.on, transition);
    }

    return stateMachineClass;
  };

  StateMachine.extend = extend;

  return Squirrel;
}));
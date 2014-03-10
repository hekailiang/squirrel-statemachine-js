/*global require, module, it, describe*/
/*jshint expr: true*/
var should = require('chai').should(),
		expect = require('chai').expect,
    squirrel = require('../index'),
    StateMachine = squirrel.StateMachine;

describe('#StateMachine basic function', function() {
	'use strict';
	var SimpleStateMachine = StateMachine.extend({
		// state machine definition
		definition : {
	  	initial : "A",
	  	states : {
	  		A : { onEntry: "enterA", onExit: "exitA" },
	  		B : { onEntry: "enterB", onExit: "exitB" },
	  		F : { onEntry: function() { this.callSequence += ".enterF"; }, 
	  					onExit:  function() { this.callSequence += ".exitF"; }, 
	  					final: true }
	  	},

	  	transitions : [
	  		{ from : "A", to : "B", on : "A2B", perform : "fromAToB" },
	  		{ from : "B", to : "A", on : "B2A", perform : function() { this.callSequence += ".fromBToA"; } },
	  		{ from : "B", to : "C", on : "B2C", perform : function() { this.fire("C2D"); this.fire("D2E"); } },
	  		{ from : "C", to : "D", on : "C2D" },
	  		{ from : "D", to : "E", on : "D2E" },
	  		{ from : "A", to : "F", on : "END" }
	  	]
	  },

	  // state machine initialize function
	  initialize : function() {
	 		this.callSequence = "";
	 	},

	 	// state machine actions
	  enterA : function() {
	 		this.callSequence += ".enterA";
	  },

	  exitA : function() {
	 		this.callSequence += ".exitA";
	  },

	  fromAToB : function() {
	  	this.callSequence += ".fromAToB";
	  },

	  enterB : function() {
	 		this.callSequence += ".enterB";
	 	},

  	exitB : function() {
  		this.callSequence += ".exitB";
  	}
	});

	it("A simple state machine should enter its initial states and status should be idle when started", 
		function() {
			var stateMachineInstance = new SimpleStateMachine("A");
			// expect(stateMachineInstance.getCurrentState()).to.be.null;
			stateMachineInstance.start();
			stateMachineInstance.callSequence.should.equal(".enterA");
			stateMachineInstance.getCurrentState().should.equal("A");
			stateMachineInstance.getStatus().should.equal(squirrel.StateMachineStatus.IDLE);
	});

	it("A simple state machine should throw error when it is not started and its options 'isAutoStartEnabled' set to false", 
		function() {
			var fireUnstartedFsmFunc = function() {
				var stateMachineInstance = new SimpleStateMachine("A", {isAutoStartEnabled : false, isDebugInfoEnabled: true});
				stateMachineInstance.fire("A2B");
			};
			expect(fireUnstartedFsmFunc).to.Throw(/not running/); 
	});

	it("A simple state machine should auto terminated when entering in final state with option 'isAutoTerminate' set to true.", 
		function() {
			var stateMachineInstance = new SimpleStateMachine();
  		stateMachineInstance.fire("END");
  		stateMachineInstance.callSequence.should.equal(".enterA.exitA.enterF");
  		stateMachineInstance.getStatus().should.equal(squirrel.StateMachineStatus.TERMINATED);
	});

  it("A simple external transition should include old state exit, transition perform and new state entry", 
  	function() {
	  	var stateMachineInstance = new SimpleStateMachine(), 
	  	stateMachineInstance2 = new SimpleStateMachine("B");

	  	stateMachineInstance.fire("A2B");
	  	stateMachineInstance.callSequence.should.equal(".enterA.exitA.fromAToB.enterB");

	  	stateMachineInstance2.fire("B2A");	  	
	    stateMachineInstance2.callSequence.should.equal(".enterB.exitB.fromBToA.enterA");
  });

  it("Nested fired events should be processed after processing current event finished", function() {
  	var stateMachineInstance = new SimpleStateMachine("B");
  	stateMachineInstance.fire("B2C");
  	stateMachineInstance.getCurrentState().should.equal("E");
  });
});
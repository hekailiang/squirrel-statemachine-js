/*global require, module, it, describe*/
/*jslint node: true */
'use strict';
var should = require('chai').should(),
    squirrel = require('../index'),
    StateMachine = squirrel.StateMachine;

describe('#StateMachine basic function', function() {
  it('simple external transition should include old state exit, transition perform and new state entry', 
  	function() {
	  	var SimpleStateMachine = StateMachine.extend({
	  		definition : {
	  			initial : "A",
	  			states : {
	  				A : { onEntry: "enterA", onExit: "exitA" },
	  				B : { onEntry: "enterB", onExit: "exitB"}
	  			},

	  			transitions : [
	  				{from : "A", to : "B", on : "A2B", perform : "fromAToB"},
	  				{from : "B", to : "A", on : "B2A", perform : "fromBToA"}
	  			]
	  		},

	  		initialize : function() {
	  			this.callSequence = "";
	  		},

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
	  		},

	  		fromBToA : function() {
	  			this.callSequence += ".fromBToA";
	  		}

	  	}), 
	  	stateMachineInstance = new SimpleStateMachine("A"), 
	  	stateMachineInstance2 = new SimpleStateMachine("B");

	  	stateMachineInstance.fire("A2B");
	  	stateMachineInstance.callSequence.should.equal(".exitA.fromAToB.enterB");

	  	stateMachineInstance2.fire("B2A");	  	
	    stateMachineInstance2.callSequence.should.equal(".exitB.fromBToA.enterA");
  });
});
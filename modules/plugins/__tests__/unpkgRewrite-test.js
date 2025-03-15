import * as babel from '@babel/core';

import unpkgRewrite from '../unpkgRewrite.js';

const testCases = [
  {
    before: 'import React from "react";',
    after: 'import React from "https://unpkg.com/react@15.6.1?module";'
  },
  {
    before: 'import router from "@angular/router";',
    after:
      'import router from "https://unpkg.com/@angular/router@4.3.5?module";'
  },
  {
    before: 'import map from "lodash.map";',
    after: 'import map from "https://unpkg.com/lodash.map@4.6.0?module";'
  },
  {
    before: 'import fs from "pn/fs";',
    after: 'import fs from "https://unpkg.com/pn@1.0.0/fs?module";'
  },
  {
    before: 'import cupcakes from "./cupcakes";',
    after: 'import cupcakes from "./cupcakes?module";'
  },
  {
    before: 'import shoelaces from "/shoelaces";',
    after: 'import shoelaces from "/shoelaces?module";'
  },
  {
    before: 'import something from "//something.com/whatevs";',
    after: 'import something from "//something.com/whatevs";'
  },
  {
    before: 'import something from "http://something.com/whatevs";',
    after: 'import something from "http://something.com/whatevs";'
  },
  {
    before: 'let ReactDOM = require("react-dom");',
    after: 'let ReactDOM = require("react-dom");'
  },
  {
    before: 'export React from "react";',
    after: 'export React from "https://unpkg.com/react@15.6.1?module";'
  },
  {
    before: 'export { Component } from "react";',
    after: 'export { Component } from "https://unpkg.com/react@15.6.1?module";'
  },
  {
    before: 'export * from "react";',
    after: 'export * from "https://unpkg.com/react@15.6.1?module";'
  },
  {
    before: 'export var message = "hello";',
    after: 'export var message = "hello";'
  },
  {
    before: 'import("./something.js");',
    after: 'import("./something.js?module");'
  },
  {
    before: 'import(`./something.js`);',
    after: 'import(`./something.js?module`);'
  },
  {
    before: 'import("react");',
    after: 'import("https://unpkg.com/react@15.6.1?module");'
  }
];

const origin = 'https://unpkg.com';
const dependencies = {
  react: '15.6.1',
  '@angular/router': '4.3.5',
  'lodash.map': '4.6.0',
  pn: '1.0.0'
};

describe('Rewriting imports/exports', () => {
  testCases.forEach(testCase => {
    it(`rewrites '${testCase.before}' => '${testCase.after}'`, () => {
      const result = babel.transform(testCase.before, {
        plugins: [unpkgRewrite(origin, dependencies)]
      });

      expect(result.code).toEqual(testCase.after);
    });
  });
});

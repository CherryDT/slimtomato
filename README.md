# slimtomato
## A slim website automation system for node.js

<a href="https://standardjs.com" style="float: right; padding: 0 0 20px 20px;"><img src="https://cdn.rawgit.com/feross/standard/master/sticker.svg" alt="Standard JavaScript" width="100" align="right"></a>

* [Introduction](#introduction)
* [Core concept](#core-concept)
    * [Tomatoes and steps](#tomatoes-and-steps)
    * [Results and options](#results-and-options)
* [Tomato class](#tomato-class)
* [Step types](#step-types)
    * [Request](#request)
    * [Callback](#callback)
    * [Assertion](#assertion)
    * [LinkClicker](#linkclicker)
    * [FormFiller](#formfiller)
* [Creating a custom step type](#creating-a-custom-step-type)
* [License](#license)

## Introduction

The goal of the "slim tomato" - whose name comes from "au[tomato]r", by the way - is to fill the need of a very basic and slim library to automate interaction with simple websites. It provides a simple and fast way to simulate user interaction at "HTTP level" - sending a request and then following up with "clicking" links, filling forms, and so on.

Let's start with an example to see what the tomato can do:

```javascript
/* This example attempts to log into the CTEC backend and extract the user's full name */

// Require the tomato
const {Tomato, Request, FormFiller, Assertion, Callback} = require('slimtomato')

// Credentials to log in with (of course, these won't work)
const username = '1234'
const password = 'ABC123'

// Create a tomato, with some lifecycle hooks for debug output
const tomato = new Tomato({
  beforeStep: step => console.log(`Executing step: ${step.name}`),
  afterStep: step => console.log(`Step done: ${step.name}`),
  beforeRequest: (step, request) => console.log(`Step "${step.name}" is sending request:`, request)
})

// Execute our automation pipeline
tomato.runSteps([
  // First, open the login page
  new Request('Open login page', {uri: 'https://www.ctec.org/Provider/Logon'}),

  // Then, attempt to log in by filling and submitting the login form
  new FormFiller('Log in', {
    selector: '#form1',
    callback: dataObject => { // dataObject already contains the initial values
      // These weird names are what the website uses, don't blame me...
      dataObject.ctl00$ctl00$cphBodyContent$cphContent$txtUserID = username
      dataObject.ctl00$ctl00$cphBodyContent$cphContent$txtPassword = password
    },
    autoRequest: true
  }),

  // Before we continue, verify that the previous step (our login) was successful
  new Assertion('Verify that login worked', {
    // Check that we were redirected to the account dashboard
    callback: result => result.request.uri.href === 'https://www.ctec.org/Provider/Account/Main/',

    // If not, return the actual URL as part of the error message
    explanator: result => `URL was ${result.request.uri.href}`
  }),

  // Let's extract the user's full name
  new Callback('Extract full name', {
    callback: ({$}) => $('#cphBodyContent_cphContent_uclProviderDetails_lblName').text()
  })
]).then(userFullName => {
  // The result from the tomato's promise was the result of its last step
  // That is, our user's full name
  console.log(`Hello, ${userFullName}!`)
}).catch(console.error) // If something failed, we'd see it
```

slimtomato does:

* Allow writing a pipeline of automation steps which are executed in order and depend on one another (with support for assertions and custom steps)
* Provide access to the DOM of a webpage using familiar jQuery-style syntax
* Allow conveniently filling and submitting web forms (honoring default values and hidden fields), including support for file uploads
* Allow conveniently "clicking" links on a page
* Remember cookies
* Send a `Referer` header where applicable

slimtomato does **not**:

* Execute website JavaScript
* Load referenced resources like images, stylesheets, etc.
* Render anything
* Try to emulate a browser (with all the expected HTTP headers, etc.)
* ...any other fancy bells and whistles like this

slimtomato is a thin wrapper around [request-promise](https://www.npmjs.com/package/request-promise) (actually [request-promise-native](https://www.npmjs.com/package/request-promise-native)), combined with [cheerio](https://www.npmjs.com/package/cheerio) (something like a "jQuery for node.js") to allow working easily with the HTML that is coming from the website, with a bit of logic on top that simplifies working with HTML forms.

This means that slimtomato is meant to be used to automate "simple" (and/or older) websites which neither depend on fancy things on the client nor do active bot-prevention (such as many "internal" websites which become relevant when automating business workflows in companies). If this is not enough for your use case, take a look at full-blown "headless browser" solutions like [PhantomJS](http://phantomjs.org/), which can work with more websites than slimtomato can.

**How to install?** As usually: `npm i slimtomato` 😊

## Core concept

### Tomatoes and steps

The `slimtomato` package exports a number of ES6 classes. These are `Tomato` and different step types.

An instance of `Tomato` is called "a **tomato**". A tomato can have state (although by default, the only state it has is a cookie jar, accessible in `tomato.jar`). `tomato.runSteps(arrayOfSteps)` can be called to run a pipeline on the tomato.

An automation pipeline consists of a number of **steps**. Steps are executed in order, they are usually expected to return a result value (or another step which will then be executed immediately and its result value will be forwarded) and they have access to the previous step's result. The last step's result is made available to the surrounding code that uses the tomato.

There are different kinds of steps (such as `Request` or `FormFiller`). All steps are derived from a base class `Step`. Steps usually have options.

Every step has a name. It is used both for briefly documenting the pipeline in the code and for debugging, since it can be accessed in many places and is also by default included in all error messages.

To add a step to your pipeline, you create an instance of the desired step type, usually like this: `new StepType(name, options)`.

### Results and options

Steps usually have a **result**. Steps can also access the previous step's result. This allows to have steps which transform data from previous steps. If a step returns another step instance as "result", then the tomato will execute the newly created step immediately before executing the next one in the pipeline. *Note: Such a "generated" step cannot access previous data at the moment.*

Steps usually take **options** which define their parameters. There are three ways to set options:

* By specifying an object. This will simply use the options defined in the object.
    ```javascript
    new SomeStepType('Something', {
      hello: 'world'
    })
    ```
* By specifying a function (can be `async`). The function will get the previous step's result as parameter and should return the final options object. This allows to set options dynamically.
    ```javascript
    new SomeStepType('Something', result => ({
      hello: result.world
    }))
    ```
* By specifying `true`. This will use the previous step's result as options.
    ```javascript
    new SomeStepType('Something', true)
    ```

## Tomato class

A tomato is instantiated like this: `new Tomato(options)`.

`options` is an optional object which can have the following properties:

* `jar`: A `request` cookie jar. If not specified, a new one is created automatically (and can be read using `tomato.jar` later).
* `beforeStep`: A function with parameter `step` which is called before a step is executed. `step` is at the moment just an object `{name}`.
* `afterStep`: A function with parameter `step` which is called after a step was executed. `step` is at the moment just an object `{name, result}`.
* `beforeRequest`: A function with parameters `(step, request)` which is called before the `Request` step type initiates an HTTP request. `step` is at the moment just an object `{name}` and `request` is the [options object passed to request-promise](https://www.npmjs.com/package/request-promise#cheat-sheet)

Additionally, you can add arbitrary fields into the options object, which will become properties of the created tomato.

The tomato instance additionally exposes a `lastStep` property which is again an object `{name, result}`.

For running a pipeline, the tomato instance has one method: `runSteps`. It takes an array of step instances as parameter and it returns a promise that resolves to the last step's result. If any step in the pipeline throws an error, the promise is rejected.

## Step types

This section describes all the step types available by default. "Input" describes how the previous step's result is used (if at all), "Options" describes which options are supported, and "Output" describes what the step's result will be.

### Request

The `Request` step type is "the core" of slimtomato. Most of the time, you will operate on results from this step type. It is a thin wrapper around [request-promise](https://www.npmjs.com/package/request-promise) (actually [request-promise-native](https://www.npmjs.com/package/request-promise-native)). Additionally, the website's response is parsed using [cheerio](https://www.npmjs.com/package/cheerio).

* **Input:** Ignored.
* **Options:** Mostly the [options object passed to request-promise](https://www.npmjs.com/package/request-promise#cheat-sheet), with small differences:
  * By default the `jar` property is initialized with `tomato.jar` (to allow remembering cookies), and `followAllRedirects: true` is set. These can be overwritten in the options object.
  * A new property `raw: true` may be set to prevent parsing the response body with [cheerio](https://www.npmjs.com/package/cheerio).
* **Output**: The return value of the request-promise call, augmented with a `$` property with cheerio's result. The most important properties are:
  * `$`: DOM parsed by [cheerio](https://www.npmjs.com/package/cheerio). You can use it for most intents and purposes like jQuery's `$` to access the returned HTML.
  * `body`: Raw response body.
  * `request`: Describes the final request, after redirects (so you can use `result.request.uri.href` to verify that you "landed" on the right page after a login, for example).

**Example:**

```javascript
new Request('Open a page', {
  uri: 'https://www.google.com'
})
// Result will allow you to use things like result.$('[name=btnK]').text()
```

### Callback

The `Callback` step type simply executes the specified callback with the result of the previous step as parameter and passes the return value as result to the next step. It can be used to transform values or to store or log them.

* **Input**: Passed to the callback.
* **Options**:
  * `callback`: A function (can be `async`) which receives the previous step's result as parameter. The return value of this function is used as this step's result. (So, if you are only observing something, don't forget to `return result` at the end.)
* **Output**: Return value of the callback.

**Example:**

```javascript
new Callback('Log search button text', {
  callback: result => {
    console.log('Search button text:', result.$('[name=btnK]').text())
    return result
  }
})
```

### Assertion

The `Assertion` step type is a convenience wrapper around `Callback` which verifies that a given condition is true. If it is not, an exception is thrown, optionally with a customizable "explanation". It is designed to verify that the last step worked before continuing.

* **Input:** Passed to the callback.
* **Options:**
  * `callback`: A function (can be `async`) which receives the previous step's `result` as parameter and is expected to return a truthy or falsy value to indicate success or failure. If a falsy version is returned, an exception will be thrown.
  * `explanator`: Optional function (can *not* by `async`!) which is invoked in case the callback failed. It also receives `result` as parameter and should return a string which describes why the assertion failed.
* **Output:** Input passed through.

**Example:**

```javascript
new Assertion('Verify that we landed on the right page', {
  callback: result => result.request.uri.hostname.match(/google/),
  explanator: result => `URL was ${result.request.uri.href}`
})
```

### LinkClicker

The `LinkClicker` step type extracts the URL of a link specified by a selector and prepares a request to that URL (including `Referer`). If `autoRequest: true` is specified, the request is also executed.

Note: At the moment, `<base>` tags are not handled.

* **Input:** Must be the result of a `Request` step (or a `LinkClicker`/`FormFiller` with `autoRequest: true`).
* **Options:**
  * `selector`: CSS selector of the link to be "clicked".
  * `autoRequest`: If set to `true`, the request is executed immediately (a `Request` step is generated to do so). Otherwise, only the request options are prepared.
* **Output.**
  * If `autoRequest` is enabled, the output will be the output of the generated `Request` step that simulated "clicking" the link.
  * If `autoRequest` is disabled, the output will be the request options object ready to be passed into a `Request`.

**Example:**

```javascript
new LinkClicker('Click on "Settings" link', {
  selector: '#fsettl',
  autoRequest: true
})
// Result will be the "Settings" page
```

### FormFiller

The `FormFiller` step type is the most complex one. It allows to simulate filling a web form.

It will identify a form based on a CSS selector, prefill an object with the default values already set in the form (including hidden fields), allow modifying this object (e.g. setting new values) and then prepare a request to submit the filled form (optionally using a specified submit button in case there are multiple), with the right headers and data. If `autoRequest: true` is specified, the request is also executed. Uploading files is also possible.

Note: At the moment, `<base>` tags are not handled.

* **Input:** Must be the result of a `Request` step (or a `LinkClicker`/`FormFiller` with `autoRequest: true`).
* **Options:**
  * `selector`: CSS selector identifying the form to submit.
  * `submitSelector`: Optional CSS selector identifying the submit button to use (in case there are multiple).
  * `callback`: A function that receives an object with the existing form data (default values, hidden fields) as parameter and can modify this object (for example, set new values).
    * The keys are the names of the form fields. The values are the string values of the form fields, or arrays with such values in case there was more than one field with the same name.
    * To upload files, set the file field to an object `{value, options: {filename, contentType}}` as described [here](https://github.com/request/request-promise#post-like-html-forms-do).
  * `autoRequest`: If set to `true`, the request is executed immediately (a `Request` step is generated to do so). Otherwise, only the request options are prepared.
* **Output:**
  * If `autoRequest` is enabled, the output will be the output of the generated `Request` step that simulated "submitting" the link.
  * If `autoRequest` is disabled, the output will be the request options object ready to be passed into a `Request`.

**Example:**

```javascript
new FormFiller('Submit search', {
  selector: '[name=f]',
  submitSelector: '[name=btnK]',
  callback: dataObject => {
    dataObject.q = 'Hello World'
  },
  autoRequest: true
})
// Result will be the search results page
```

## Creating a custom step type

If you want to create your own step type, you can extend `Step` as follows:

```javascript
const {Step} = require('slimtomato')

class MyNewStepType extends Step {
  run (tomato, prev) {
    // Implementation here.
    //   tomato: The tomato instance
    //   prev: Object {name, result} of last step
    // You can access this.options to get your step's current options.
    // You can return a value, a promise or another step instance.
  }
}
```

Of course, you can also extend a preexisting step type (but then don't forget to call `super.run`).

## License

[MIT](https://oss.ninja/mit?organization=David%20Trapp)

const rp = require('request-promise-native')
const cheerio = require('cheerio')
const url = require('url')

class Step {
  constructor (name, options) {
    this.name = name

    if (options === true) {
      this.evaluator = x => x
    } else if (typeof options === 'function') {
      this.evaluator = options
    } else {
      this.options = options
    }
  }

  prepare (tomato, prev) {
    if (this.evaluator) {
      return Promise.resolve().then(() => this.evaluator(prev.result)).then(options => {
        this.options = options
      })
    }
  }

  prepareAndRun (tomato, prev) {
    return Promise.resolve().then(() => this.prepare(tomato, prev)).then(() => this.run(tomato, prev))
  }

  run (tomato, prev) {
    throw new Error('Step has no implementation')
  }
}

class Request extends Step {
  run (tomato, prev) {
    if (tomato.beforeRequest) tomato.beforeRequest(this, this.options)
    return rp(Object.assign({
      jar: tomato.jar,
      followAllRedirects: true
    }, this.options, {
      resolveWithFullResponse: true
    })).then(result => {
      if (!this.options.raw) result.$ = cheerio.load(result.body)
      return result
    })
  }
}

class Callback extends Step {
  run (tomato, prev) {
    return this.options.callback(prev.result)
  }
}

class Assertion extends Callback {
  run (tomato, prev) {
    return Promise.resolve().then(() => super.run(tomato, prev)).then(success => {
      if (success) {
        return prev.result
      } else {
        const explanation = this.options.explanator ? ' - ' + this.options.explanator(prev.result) : ''
        throw new Error(`Assertion failed: ` + this.name + explanation)
      }
    })
  }
}

class LinkClicker extends Step {
  run (tomato, prev) {
    const {$} = prev.result
    const $link = $(this.options.selector)
    if (!$link.length) throw new Error(`Cannot find link with selector "${this.options.selector}"`)

    const requestOptions = {
      uri: url.resolve(prev.result.request.uri, $link.attr('href') || ''),
      headers: {Referer: prev.result.request.uri.href}
    }

    if (this.options.autoRequest) {
      return new Request('Request:' + this.name, requestOptions)
    } else {
      return requestOptions
    }
  }
}

class FormFiller extends Step {
  run (tomato, prev) {
    const {$} = prev.result
    const $form = $(this.options.selector)
    if (!$form.length) throw new Error(`Cannot find form with selector "${this.options.selector}"`)
    const fieldArray = $form.serializeArray()
    const $btn = $form.find(this.options.submitSelector || '[type=submit]')
    if ($btn.length) {
      if ($btn.attr('name')) {
        fieldArray.push({
          name: $btn.attr('name'),
          value: $btn.attr('value')
        })
      }
    } else if (this.options.submitSelector) {
      throw new Error(`Cannot find submit button with selector "${this.options.submitSelector} in form"`)
    }

    const dataObject = {}
    for (const field of fieldArray) {
      if (field.name in dataObject) {
        if (!Array.isArray(dataObject[field.name])) dataObject[field.name] = [dataObject[field.name]]
        dataObject[field.name].push(field.value)
      } else {
        dataObject[field.name] = field.value
      }
    }

    return Promise.resolve().then(() => {
      if (this.options.callback) return this.options.callback(dataObject)
    }).then(() => {
      const requestOptions = {
        uri: url.resolve(prev.result.request.uri, $form.attr('action') || ''),
        method: $form.attr('method') || 'GET',
        headers: {Referer: prev.result.request.uri.href}
      }

      if (requestOptions.method === 'GET') {
        requestOptions.qs = dataObject
      } else if ($form.attr('enctype') === 'multipart/form-data') {
        requestOptions.formData = dataObject
      } else {
        requestOptions.form = dataObject
      }

      if (this.options.autoRequest) {
        return new Request('Request:' + this.name, requestOptions)
      } else {
        return requestOptions
      }
    })
  }
}

class Tomato {
  constructor (options) {
    Object.assign(this, options)
    if (!this.jar) this.jar = rp.jar()
  }

  runSteps (steps) {
    const runSingleStep = step => {
      const prevStep = this.lastStep
      this.lastStep = {
        name: step.name
      }

      if (this.beforeStep) this.beforeStep(this.lastStep)

      return Promise.resolve().then(() => step.prepareAndRun(this, prevStep)).then(result => {
        this.lastStep.result = result
        if (this.afterStep) this.afterStep(this.lastStep)
        if (result instanceof Step) return runSingleStep(result)
      }, error => {
        error.stepName = step.name
        const oldErrorToString = error.toString
        error.toString = function () {
          return oldErrorToString.call(this) + ` [at step "${this.stepName}"]`
        }
        throw error
      })
    }

    return steps.reduce((promiseChain, step) => {
      return promiseChain.then(() => runSingleStep(step).then(() => this.lastStep.result))
    }, Promise.resolve())
  }
}

module.exports = {Step, Request, Callback, Assertion, LinkClicker, FormFiller, Tomato}

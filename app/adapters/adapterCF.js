'use strict';

const path    = require('path'),
      async   = require('async'),
      Browser = require('zombie'),
      assert  = require('assert'),
      cheerio = require('cheerio'),
      util    = require('util');

const Adapter       = require('../adapters/adapter'),
      Defaults      = require('../config/defaults'),
      Errors        = require('../utils/errors'),
      RequestClient = require('../utils/requestClient');

const HOST              = "codeforces.com",
      LOGIN_PAGE_PATH   = "/enter",
      SUBMIT_PAGE_PATH  = "/problemset/submit",
      STATUS_PATH       = "/problemset/status",
      SUBMISSIONS_PATH  = "/problemset/status?friends=on",
      SUBMISSIONS_API   = "/api/user.status?handle=%s&count=%s";

const LOGIN_TEST_REGEX      = /logout/i,
      LLD_REGEX             = /preferred\s+to\s+use\s+cin/i;

const TYPE = /^adapter(\w+)/i.exec(path.basename(__filename))[1].toLowerCase();

module.exports = (function(parentCls) {

  function AdapterCF(acct) {
    parentCls.call(this, acct);

    const browser = new Browser({runScripts: false, waitDuration: "15s"});
    const client = new RequestClient('http', HOST);

    function login(callback) {
      async.waterfall([
        (next) => {
          browser.visit("http://" + HOST + LOGIN_PAGE_PATH, next)
        },
        (next) => {
          browser
            .fill('#handle', acct.getUser())
            .fill('#password', acct.getPass())
            .check('#remember')
            .pressButton('input[value="Login"]', next);
        }
      ], (err) => {
        let html = browser.html() || '';
        if (!html.match(LOGIN_TEST_REGEX)) {
          return callback(Errors.LoginFail);
        }
        return callback(null);
      });
    };

    this._login = login;

    function getSubmissionId(callback) {
      let submissionsUrl = util.format(SUBMISSIONS_API, acct.getUser(), 1);
      client.get(submissionsUrl, {json: true}, (err, res, data) => {
        let id;
        try {
          id = data.result[0].id + '';
          assert(id && id.length >= 6);
        } catch (e) {
          return callback(Errors.SubmissionFail);
        }
        return callback(null, id);
      });
    };

    function send(submission, retry, callback) {
      async.waterfall([
        (next) => {
          browser.visit("http://" + HOST + SUBMIT_PAGE_PATH, next);
        },
        (next) => {
          if (browser.location.pathname === LOGIN_PAGE_PATH) {
            return next(Errors.LoginFail);
          }
          browser
            .fill('input[name="submittedProblemCode"]', submission.problemId)
            .select('select[name="programTypeId"]', submission.language)
            .fill('#sourceCodeTextarea', submission.code)
            .pressButton('input[value="Submit"]', next);
        },
        (next) => {
          let html = browser.html() || '';
          if (html.match(LLD_REGEX)) {
            return browser.check('input[name="doNotShowWarningAgain"]')
              .pressButton('input[value="Submit"]', next);
          }
          return next();
        }
      ], (err) => {
        if (err && !retry) {
          return callback(err);
        } else if (browser.location.pathname === LOGIN_PAGE_PATH) {
          if (!retry) {
            return callback(Errors.SubmissionFail);
          } else {
            return login((err) => {
              if (err) return callback(err);
              return send(submission, false, callback);
            });
          }
        } else if (browser.location.pathname !== STATUS_PATH) {
          if (browser.html()) {
            return callback(Errors.InternalError);
          } else {
            return callback(Errors.SubmissionFail);
          }
        }
        return getSubmissionId(callback);
      });
    };

    this._send = (submission, callback) => {
      return send(submission, true, callback);
    }

    function judge(judgeSet, callback) {
      let submissionsUrl = util.format(SUBMISSIONS_API, acct.getUser(), 30);
      client.get(submissionsUrl, {json: true}, (err, res, data) => {
        data = data.result;
        for (let i = 0; i < data.length; i++) {
          if (judgeSet[data[i].id]) {
            judgeSet[data[i].id].verdict = data[i].verdict;
          }
        }
        return callback();
      });
    }

    this._judge = judge;
  }

  // Problems Fetcher
  (function(obj) {
    const PROBLEMSET_API = "/api/problemset.problems";

    const client = new RequestClient('http', HOST);

    obj.import = (problem, callback) => {
      let url = Defaults.oj[TYPE].getProblemPath(problem.id);
      client.get(url, (err, res, html) => {
        if (err) return callback(err);
        let content;
        try {
          let $ = cheerio.load(html);
          content = $('div.problemindexholder');
          content.removeAttr('problemindex');
          content.find('.header > .title').remove();
        } catch (err) {
          return callback(err);
        }
        require('fs').writeFileSync('test.html', content);
        //return callback(null, content.html());
      });
    }

    obj.fetchProblems = (callback) => {
      let problems = [];
      async.waterfall([
        (next) => {
          client.get(PROBLEMSET_API, {json: true}, next);
        },
        (res, data, next) => {
          try {
            data = data.result.problems;
            for (let i = 0; i < data.length; i++) {
              problems.push({
                id: data[i].contestId + data[i].index,
                name: data[i].name,
                oj: TYPE
              });
            }
            return next(null, problems);
          } catch (err) {
            return next(err);
          }
        }
      ], callback);
    }
  })(AdapterCF);

  return AdapterCF;
})(Adapter);
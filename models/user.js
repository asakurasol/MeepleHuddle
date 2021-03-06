module.exports = (function() {
  var mongoose = require('mongoose') // MongoDB abstraction layer
    , Schema = mongoose.Schema // Mongoose Schema constructor
    , ObjectId = Schema.ObjectId // Mongoose ObjectId type

    , crypto = require('crypto') // encryption utility library
    , async = require('async') // flow control utility library
    , _ = require('underscore') // list utility library

    , db = require('./db')
    , BoardGame = require('./board_game'); // make sure db is connected

    //, mailer = require('../mailer') // used to send emails

  /* the schema - defines the "shape" of the documents:
   *   gets compiled into one or more models */
  var UserSchema = new Schema({
  // instance properties - document.field_name
    //the user's username
    username           : { type: String, unique: true }
    //the user's password, hashed with SHA-1
  , password           : String
    //the user's email address
  , email              : { type: String, trim: true }
    //the code used to confirm this user's email
  //, confirmation_code: String
    //whether the user has confirmed his/r email address
  //, email_confirmed    : { type: Boolean, default: false }
  //, recovery_code      : { type: String }
  , registration_date  : { type: Date, default: Date.now }
  , metrics: {
      internal: {
        aesthetic      : Number // 1-5
      , challenge      : Number // 1-5
      , pass_time      : Number // 1-5
      , narrative      : Number // 1-5
      , discovery      : Number // 1-5
      , chance         : Number // 1-5
      }
    , external: {
        confrontation  : Number // 1-5
      , manipulation   : Number // 1-5
      , accumulation   : Number // 1-5
      , teamwork       : Number // 1-5
      }
    , len           : Number // sqrt(SUMPRODUCT(all metrics, all metrics))
    }
  , games: {
      liked            : String
    , disliked         : String
    }
  }, { minimize: false }); // set minimize to false to save empty objects

  // static methods - Model.method()
  UserSchema.statics.createUser = function(spec, cb) {
    var username = spec.username
      , pt_password = spec.pt_password
      , error;
    console.log('createUser called for', spec);
    if (_.escape(username) !== username) {
      error = 'The following characters are not allowed in usernames: & < > " \' /';
    }
    else if (! _.isString(pt_password)) {
      error = 'User.createUser called without pt_password!';
    }
    if (error) {
      console.error(error);
      return cb(error);
    }

    spec.password = User.encryptPassword(pt_password);
    delete spec.pt_password;

    var user = new User(spec);
    console.log('created user with', spec, user);
    user.save(function(save_err, result) {
      if (save_err) {
        error = 'Error during save: ' + save_err;
        return cb(error);
      }
      /*if (! _.isEmpty(spec.email)) {
        user.sendConfirmationEmail(spec.email, function(email_err) {
          if (email_err) {
            error = 'Error while sending email: ' + email_err;
            return cb(error);
          }
          cb(null, result);
        })
      }
      else {*/
      cb(null, result);
      //}
    });
  };

  UserSchema.statics.authenticate = function(username, password, cb) {
    var model = this;
    // look for a matching username/password combination
    model.findOne({
      username: username,
      password: User.encryptPassword(password)
    }, cb);
  };

  /*UserSchema.statics.generateConfirmationCode = function(cb) {
    crypto.randomBytes(16, function(err, buf) {
      if (err) {
        cb(err);
      }
      else {
        var confirmation_code = buf.toString('hex');
        cb(null, confirmation_code);
      }
    });
  };
  
  UserSchema.statics.generatePasswordRecoveryCode = function(cb) {
    crypto.randomBytes(16, function(err, buf) {
      if (err) {
        cb(err);
      }
      else {
        var recovery_code = buf.toString('hex');
        cb(null, recovery_code);
      }
    });
  };*/

  UserSchema.statics.getByIdWithoutPassword = function(id, cb) {
    User.findOne({ _id: id }, { password: false }, cb);
  };

  UserSchema.statics.encryptPassword = function(pt_password) {
    var shasum = crypto.createHash('sha1');
    if (_.isString(pt_password)) {
      shasum.update(pt_password);
      shasum = shasum.digest('hex');
    }
    else {
      console.log('User.encryptPassword called without pt_password!');
      shasum = null;
    }
    return shasum;
  };

  // instance methods - document.method()
  /*UserSchema.methods.sendConfirmationEmail = function(email, cb) {
    var self = this
      , error = null
      , valid = true; //this is a stub to hold the place for a email validator functionality. 
    //if email is valid, save it to MongoDB
    if (valid) {
      //attach e-mail to user
      User.generateConfirmationCode(function(err, confirmation_code) {
        if (err) {
          error = 'Error while generating confirmation code:' + err;
          console.error(error);
          cb(error);
        }
        else {
          self.update({ $set: { email: email, confirmation_code: confirmation_code } },
                      function(err) {
            if (err) {
              error = 'Error when saving email to database:' + err;
              console.error(error);
            }
            else {
              console.log('Email saved to ' + self.username + '\'s account.');
              mailer.sendConfirmationEmail(email, confirmation_code, self.username);
            }
            cb(error);
          });
        }
      });
    }
  };*/

  // find top [num] board game recommendations for user
  UserSchema.methods.getRecommendations = function(num, cb) {
    var user = this;
    //console.log({ $nin: user.games.liked, $nin: user.games.disliked });
    BoardGame.find(function(find_err, board_games) {
      console.log('find returns', find_err, board_games);
      if (find_err) { return cb(find_err); }
      // wtf, iterating over full metrics obj doesn't work
      var user_metrics = user.metrics
        , board_game_metrics
        , sum_product;
      _.each(board_games, function(board_game) {
        board_game_metrics = board_game.metrics;
        sum_product = BoardGame.calculateSumProduct(user_metrics, board_game_metrics);
        //console.log('Setting', board_game.name, '\'s similarity', sum_product, user_metrics.len, board_game_metrics.len);
        board_game.similarity = sum_product / user_metrics.len / board_game_metrics.len;
        //console.log(board_game.similarity);
      });
      board_games = _.sortBy(board_games, 'similarity');
      //console.log('sorted board_games:', board_games);
      cb(null, _.last(board_games, num).reverse());
    });
  };

  // set user's metrics based on games' metrics
  UserSchema.methods.setMetricsFromGames = function(games, cb) {
    var user = this;
    if (! _.isArray(games.liked) || ! _.isArray(games.disliked)) {
      return cb('Non-array given to setMetricsFromGames', games);
    }

    async.parallel({
      liked: function(acb) {
        BoardGame.find({ _id: { $in: games.liked } }, acb );
      },
      disliked: function(acb) {
        BoardGame.find({ _id: { $in: games.disliked } }, acb );
      }
    }, function(find_err, results) {
      if (find_err) { return cb(find_err); }
      var liked_metrics = _.pluck(results.liked, 'metrics')
        , disliked_metrics = _.pluck(results.disliked, 'metrics')
        , user_metrics = {
            internal: {
              aesthetic: 3
            , challenge: 3
            , pass_time: 3
            , narrative: 3
            , discovery: 3
            , chance: 3
            }
          , external: {
              confrontation: 3
            , manipulation: 3
            , accumulation: 3
            , teamwork: 3
            }
          };
      // sum likes and dislikes
      _.each(user_metrics, function(metrics_obj, category) {
        if (_.isFunction(metrics_obj) || category === 'len') { return; }
        _.each(metrics_obj, function(val, metric) {
          // val starts at 3. change it per the liked/disliked games
          _.each(liked_metrics, function(liked_metric) {
            val += liked_metric[category][metric];
          });
          _.each(disliked_metrics, function(disliked_metric) {
            val -= disliked_metric[category][metric] / 2;
          });
          metrics_obj[metric] = val;
        });
      });

      // calculate raw length
      user_metrics.len = BoardGame.calculateSumProduct(user_metrics);
      user_metrics.len = Math.sqrt(user_metrics.len);
      console.log('raw length is', user_metrics.len);

      // divide metrics by raw length, multiply by 15
      _.each(user_metrics, function(metrics_obj, category) {
        if (_.isFunction(metrics_obj) || category === 'len') { return; }
        _.each(metrics_obj, function(val, metric) {
          val = val / user_metrics.len * 15;
          val = Math.round(val);
          if (val < 1) { val = 1; }
          else if (val > 5) { val = 5; }
          metrics_obj[metric] = val;
        });
      });
      // recalculate length
      user_metrics.len = BoardGame.calculateSumProduct(user_metrics);
      user_metrics.len = Math.sqrt(user_metrics.len);
      console.log('final length is', user_metrics.len);

      user.metrics = user_metrics;

      user.games = games;
      user.markModified('metrics');
      user.markModified('games');
      console.log('saving user:', user);
      user.save(cb);
    });

    /*BoardGame.find(function(find_err, board_games) {
      if (find_err) { return cb(find_err); }
      // wtf, iterating over full metrics obj doesn't work
      var user_metrics = user.metrics
        , board_game_metrics
        , sum_product;
      _.each(board_games, function(board_game) {
        board_game_metrics = board_game.metrics;
        sum_product = BoardGame.calculateSumProduct(user_metrics, board_game_metrics);
        //console.log('Setting', board_game.name, '\'s similarity', sum_product, user_metrics.len, board_game_metrics.len);
        board_game.similarity = sum_product / user_metrics.len / board_game_metrics.len;
        //console.log(board_game.similarity);
      });
      board_games = _.sortBy(board_games, 'similarity');
      //console.log('sorted board_games:', board_games);
      cb(null, _.last(board_games, num).reverse());
    });*/
  };

  /* the model - a fancy constructor compiled from the schema:
   *   a function that creates a new document
   *   has static methods and properties attached to it
   *   gets exported by this module */
  var User = mongoose.model('User', UserSchema);

  return User;
})();
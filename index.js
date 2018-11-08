var express = require('express');
var app = express();

var nodemailer = require('nodemailer');
var admin = require("firebase-admin");

admin.initializeApp({
    credential: admin.credential.cert("credential-keys.json"), //REMOVED PRIVATE DATA
    databaseURL: "" //REMOVED PRIVATE DATA
});


var allowCrossDomain = function (req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type');

    next();
};

app.set('port', (process.env.PORT || 5000));
app.use(allowCrossDomain);
app.use(express.static(__dirname + '/public'));

// views is directory for all template files
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

app.get('/', function (request, response) {
    response.render('pages/index');
});

// handles incoming sms messages from NEXMO webhook.
app.get('/inbound', (req, res) => {

    // check if message is validated.
    if (!req.query.to || !req.query.msisdn) {

        console.log('This is not a valid inbound SMS message!');

    } else {

        // check if message is part of a multipart message, currently ignoring messages larger than 160 chars.
        if (req.query.concat) {

            console.log('Fail: the message is too long.');
            console.log(req.query);
            /*
            {concat: 'true', 'concat-ref': '93', 'concat-total': '5', 'concat-part': '1'...}
            the message is longer than maximum number of characters allowed, and sent in multiple parts.
            */
        } else {

            // format data.
            var incomingData = {
                messageId: req.query.messageId,
                from: req.query.msisdn,
                message: req.query.text,
                timestamp: req.query['message-timestamp']
            };

            //get number message was recieved from.
            var searchstring = req.query.msisdn;
            searchstring = searchstring.substring(1);

            // create ref to list of accepted numbers (users in the fraternity who have signed up for mass text.)
            var ref = admin.database().ref("massTextList/" + searchstring);

            // check if reference exists (ie message is allowed to send mass text.)
            ref.once("value", function (snapshot) {

                //from number not in db, ignore message..
                if (snapshot.val() == null) {
                    console.log("user not found, ignore and disregard");
                }
                else {

                    // from number found corresponding user, attach user name to data.
                    console.log("user found..");

                    incomingData['name'] = snapshot.val()['name'];

                    // push message to the massTextQueue (messages awaiting to be sent..)
                    var reffer = admin.database().ref("massTextQueue").push(incomingData);

                }

            }, function (errorObject) {
                console.log("The read failed: " + errorObject.code);
            });

        }
    }
    res.status(200).end();
});

app.listen(app.get('port'), function () {
    console.log('Node app is running on port', app.get('port'));
});

// references to the massTextQueue (messages awaiting broadcasting..)
var textQueueRef = admin.database().ref("massTextQueue");
// ref to the massTextList (users that are allowed to send and recieve mass texts)
var massTextRef = admin.database().ref("massTextList");
// ref for testing system without spamming current users.
var massTextTestRef = admin.database().ref("massTextTestList");

// when new user is added to the list of auth users, send them a confirmation message that they have signed up successfully.
massTextTestRef.on('child_added', (data) => {

    console.log("mass test text found");
    var finalreff = admin.database().ref("massTextList/" + data.key).set(data.val());

    handleSayHello(data.val()["num"], "You are subscribed to Mass Text! You can send Mass Texts by texting them to (209)-690-0294 or via your KBTT account.", "Congrats!")
    var delRef = admin.database().ref("massTextTestList/" + data.key).remove();
});

// when a user updates their number, send confirmation message.
massTextTestRef.on('child_changed', (data) => {

    console.log("mass test text found");
    var finalreff = admin.database().ref("massTextList/" + data.key).set(data.val());

    handleSayHello(data.val()["num"], "You are subscribed to Mass Text! You can send Mass Texts by texting them to (209)-690-0294 or via your KBTT account.", "Congrats!")
    var delRef = admin.database().ref("massTextTestList/" + data.key).remove();

});

var massListNumbers = [];
var massListKBs = [];

var mastListString = "";

//get list of authorized mass texters.
massTextRef.on('child_added', (data) => {
    massListNumbers.push(data.val()['num']);
    massListKBs.push(data.key);
    console.log(data.val());
    convertToList();
});

// new message to be broadcast is in the queue, send the message then delete from db.
textQueueRef.on('child_added', (data) => {
    console.log("data sent");
    console.log(mastListString);
    handleSayHello(mastListString, data.val()['message'], data.val()['name']);
    deleteMsg(data)
});

// new message to be broadcast is in the queue, send the message then delete from db.
textQueueRef.on('child_changed', (data) => {
    console.log("data changed sent");
    console.log(mastListString);
    handleSayHello(mastListString, data.val()['message'], data.val()['name']);
    deleteMsg(data)
});

// remove sent messages from the queue and save them to the text glacier (archived messages)
function deleteMsg(data) {
    var delRef = admin.database().ref("massTextQueue/" + data.key).remove();
    var saveRef = admin.database().ref("massTextGlacier/" + data.key).update(data.val());
}


//helper functions
function convertToList() {
    for (var i = 0; i < massListNumbers.length; i++) {
        if (i == 0) {
            mastListString = massListNumbers[i]
        }
        else {
            mastListString = mastListString + ", " + massListNumbers[i]
        }
    }

    console.log(mastListString);
}

function handleSayHello(mailingList, message, name) {

    var text = name + '- ' + message;

    var from = name + " EMAIL MESSAGER REMOVED";


    var breakText = text.match(/.{1,160}/g);
    console.log(breakText);

    var count = 0;

    // broadcast mass texts through emailing cell numbers.
    emailRecursion(breakText, from, mailingList, count);

}

function emailRecursion(textArray, from, mailingList, count) {

    var transporter = nodemailer.createTransport({
        service: 'Gmail',
        auth: {
            user: '', // REMOVED PRIVATE DATA
            pass: ''  // REMOVED PRIVATE DATA
        }
    });

    var mailOptions = {
        from: from, // sender address
        to: mailingList, // list of receivers
        subject: '', // Subject line
        text: textArray[count], // plaintext body
        html: '<div dir="ltr">' + textArray[count] + '</div>' // html BODY
    };

    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.log(error);
        } else {
            console.log('Message sent: ' + textArray[count] + info.response);
            count = count + 1;

            if (textArray.length > count) {
                emailRecursion(textArray, from, mailingList, count);
            }

        }
        ;
    });
}



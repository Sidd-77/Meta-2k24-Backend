const express = require('express');
const newEvent = express.Router();
const fs = require('fs');
const dotenv = require('dotenv');
const { connectDB, disconnectDB } = require('../db')
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const sendEmail = require('../email');

var eventModel = null;

function createEvent(opts) {
    
    const modelName = `${process.env.EVENT}-${process.env.YEAR}`;
    // // Check if the model already exists
    // if (mongoose.models[modelName]) {
    //     console.log('Event already exists');
    //     return false;
    // }
    // eventModel = null;
    connectDB();
    eventModel = createEventModel(modelName, opts.fields);

    newEvent.post('/register', [
        body('name').isLength(),
        body('phone').isLength({ min: 10 }),
        body('email').isEmail(),
    ], async (req, res) => {

        if (eventModel === null) {
            return res.json({ success: false, message: 'Event not created yet' });
        }

        const currentTime = Math.floor(Date.now() / 1000);

        if (currentTime < process.env.START || currentTime > process.env.END) {
            return res.json({ success: false, message: 'Registration closed' });
        }

        const totalUsers = await eventModel.countDocuments();

        if (totalUsers >= process.env.MAX_USERS) {
            return res.json({ success: false, message: 'Registration full.' });
        }

        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        try {
            const userObj = {};
            for (const key in opts.fields) {
                const fieldValue = opts.fields[key];

                if (fieldValue !== -1) {
                    userObj[key] = req.body[key];
                }
            }

            await eventModel.create(userObj);
            fs.readFile('emailBody.html', 'utf-8', (error, htmlContent) => {
                if (error) {
                    console.error(`Error reading email file 'emailBody.html':`, error.message);
                } else {
                    sendEmail(userObj.email, process.env.EMAIL_SUBJECT, htmlContent);
                    res.json({ success: true , message: userObj.email + ' registered successfully'});
                }
            });

        }
        catch (err) {
            console.log(err);
            res.status(500).json({ success: false, error: 'Internal Server Error', message: err.message});
        }
    })
}

newEvent.post('/schedule', [], (req, res) => {



    const opts = {
        event: req.body.event,
        year: req.body.year,
        start: req.body.start,
        end: req.body.end,
        mongo_uri: req.body.uri,
        email: req.body.email,
        email_body: req.body.email_body,
        email_subject: req.body.email_subject,
        email_appkey: req.body.email_appkey,
        max_users: req.body.max_users,
        fields: {
            name: req.body.fields.name,
            phone: req.body.fields.phone,
            email: req.body.fields.email,
            college: req.body.fields.college,
            yearOfstudy: req.body.fields.yearOfstudy,
            isDualBooted: req.body.fields.isDualBooted,
            referralCode: req.body.fields.referralCode,
        },
    }

    try {
       
        const modelName = `${process.env.EVENT}-${process.env.YEAR}`;
        // Check if the model already exists
        if (mongoose.models[modelName]) {
            res.json({ success: false, message: 'Event '+modelName+' is already ongoing' });
            return;
        }

        disconnectDB()
        //save opts.email to a file
        const emailFilePath = 'emailBody.html';
        fs.writeFileSync(emailFilePath, opts.email_body, 'utf-8', err => {
            if (err) {
                console.log(err);
            }
        }
        );

        console.log(`Email Body saved to ${emailFilePath}`);


        const envContent = Object.keys(opts)
            .filter(key => key !== 'fields' && key !== 'email_body')
            .map(key => `${key.toUpperCase()}=${opts[key]}`)
            .join('\n');

        const fileName = '.env';

        fs.writeFile(fileName, envContent, (err) => {
            if (err) {
                console.error('Error creating file:', err);
                res.status(500).json({ success: false, error: 'Internal Server Error',  message: err.message });
            } else {
                console.log('File created successfully!');
                const result = dotenv.config({ path: fileName });

                if (result.error) {
                    console.error('Error loading .env file:', result.error);
                    res.status(500).json({ success: false, error: 'Internal Server Error' , message: result.error.message});
                } else {
                    console.log('.env file loaded successfully!');
                    if (!createEvent(opts)) {
                        res.json({ success: true , message: 'Event created successfully'});
                    }
                    else res.status(500).json({ success: false, error: 'Internal Server Error', message: 'Event creation failed'});
                }
            }
        });
    }
    catch (err) {
        console.log(err);
        res.status(500).json({ success: false, error: 'Internal Server Error',  message: err.message});
    }
})


newEvent.get('/totalregistered', async (req, res) => {
    if (eventModel === null) {
        res.json({ success: false, message: 'Event not created yet' });
        return;
    }
    const totalUsers = await eventModel.countDocuments();
    res.json({ success: true, count: totalUsers });
})

newEvent.get('/listofusers', async (req, res) => {
    if (eventModel === null) {
        res.json({ success: false, message: 'Event not created yet' });
        return;
    }
    const users = await eventModel.find();
    res.json({ success: true, users: users });
})

const generateDynamicSchema = (fields) => {
    const dynamicSchema = {};

    for (const key in fields) {
        const fieldValue = fields[key];
        // Add a condition for isDualBooted to be of type Boolean
        if (key === 'isDualBooted' && fieldValue !== -1) {
            dynamicSchema[key] = {
                type: Boolean,
                required: true,
            };
            continue
        }

        if (fieldValue === 1) {
            dynamicSchema[key] = {
                type: String,
                required: true,
            };
        } else if (fieldValue === 0) {
            dynamicSchema[key] = {
                type: String,
                required: false,
            };
        } else if (fieldValue === -1) {
            // Skip this field in the schema
            continue;
        }

    }
    return mongoose.Schema(dynamicSchema);
};


const createEventModel = (modelName, fields) => {
    const dynamicSchema = generateDynamicSchema(fields);
    return mongoose.model(modelName, dynamicSchema);
};

module.exports = newEvent
const authenticateUser = require('./authenticateUser.js');
const authenticateAdmin = require('./authenticateAdmin.js');
const authenticateAny = require('./authenticateAny.js');
const fileUploader = require('./fileUploader.js');
const {
    authenticateTeacher,
    verifyCourseOwnership,
    verifyCourseEditable
} = require('./authenticateTeacher.js');

const validateRequest = require('./validateRequest');
const authorizePartner = require('./authorizePartner');
const ucrsVerify = require('./ucrsVerify');

module.exports = {
    authenticateUser,
    authenticateAdmin,
    authenticateAny,
    authenticateTeacher,
    verifyCourseOwnership,
    verifyCourseEditable,
    fileUploader,
    validateRequest,
    authorizePartner,
    ucrsVerify,
};
const createWorkshop = require('./createWorkshop');
const getAllWorkshops = require('./getAllWorkshops');
const getMyWorkshops = require('./getMyWorkshops');
const getWorkshop = require('./getWorkshop');
const updateWorkshop = require('./updateWorkshop');
const cancelWorkshop = require('./cancelWorkshop');
const addSchedule = require('./addSchedule');
const deleteSchedule = require('./deleteSchedule');
const deleteWorkshop = require('./deleteWorkshop');
const enrollWorkshop = require('./enrollWorkshop');
const getMyEnrolledWorkshops = require('./getMyEnrolledWorkshops');
const getWorkshopEnrollees = require('./getWorkshopEnrollees');
const getAgoraToken = require('./getAgoraToken');

module.exports = {
  getAllWorkshops,
  createWorkshop,
  getMyWorkshops,
  getWorkshop,
  updateWorkshop,
  cancelWorkshop,
  addSchedule,
  deleteSchedule,
  deleteWorkshop,
  enrollWorkshop,
  getMyEnrolledWorkshops,
  getWorkshopEnrollees,
  getAgoraToken
};

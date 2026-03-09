const {
  getRideshareReport,
} = require("../../../services/salesforce/rideshareReport.service");

exports.getFullRideshareData = async () => {
  const report = await getRideshareReport();
  return report.data;
};

exports.getCasesByAgent = async (agentName) => {
  const data = await exports.getFullRideshareData();

  const filtered = data.filter((c) => c.assignedAgent?.fullname === agentName);

  return {
    total: filtered.length,
    records: filtered,
  };
};

exports.getCasesByCallCenter = async (callCenter) => {
  const data = await exports.getFullRideshareData();

  const filtered = data.filter(
    (c) => c.assignedAgent?.call_center === callCenter,
  );

  return {
    total: filtered.length,
    records: filtered,
  };
};

exports.getTotalAttemptsByAgent = async (agentName) => {
  const data = await exports.getFullRideshareData();

  const filtered = data.filter((c) => c.assignedAgent?.fullname === agentName);

  const totalAttempts = filtered.reduce(
    (sum, c) => sum + (c.totalAttempts || 0),
    0,
  );

  return {
    totalCases: filtered.length,
    totalAttempts,
    records: filtered,
  };
};

exports.getCasesByTypeFromReport = async (type) => {
  const data = await exports.getFullRideshareData();

  const filtered = data.filter(
    (c) => c.type?.toLowerCase() === type.toLowerCase(),
  );

  return {
    total: filtered.length,
    records: filtered,
  };
};

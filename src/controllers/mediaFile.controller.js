const logger = require("../utils/logger");
const {
  allMediaFiles,
  mediaFileById,
} = require("../services/mediaFile.service");

exports.allMediaFilesController = async (req, res, next) => {
  logger.info("MediaFilesController → allMediaFiles() called");

  try {
    const result = await allMediaFiles();
    logger.success("MediaFilesController → allMediaFiles() OK");
    return res.json(result);
  } catch (error) {
    logger.error(
      `MediaFilesController → allMediaFiles() error: ${error.message}`,
    );
    next(error);
  }
};

exports.mediaFileByIdController = async (req, res, next) => {
  const { id } = req.params;
  logger.info(`MediaFilesController → mediaFileById(${id}) called`);

  try {
    const result = await mediaFileById(id);
    logger.success("MediaFilesController → mediaFileById() OK");
    return res.json(result);
  } catch (error) {
    logger.error(
      `MediaFilesController → mediaFileById() error: ${error.message}`,
    );
    next(error);
  }
};

const logger = require("../utils/logger");
const { MediaFiles } = require("../models");

exports.allMediaFiles = async () => {
  logger.info("MediaFilesService → allMediaFiles() started");

  const mediaFiles = await MediaFiles.findAll();

  if (!mediaFiles || mediaFiles.length === 0) {
    const err = new Error("No media files found");
    err.status = 404;
    throw err;
  }

  logger.success("MediaFilesService → allMediaFiles() OK");
  return mediaFiles;
};

exports.mediaFileById = async (id) => {
  logger.info(`MediaFilesService → mediaFileById(${id}) started`);

  const mediaFile = await MediaFiles.findByPk(id);

  if (!mediaFile) {
    const err = new Error("Media file not found");
    err.status = 404;
    throw err;
  }

  logger.success("MediaFilesService → mediaFileById() OK");
  return mediaFile;
};

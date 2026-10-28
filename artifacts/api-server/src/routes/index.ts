import { Router, type IRouter } from "express";
import authRouter from "./auth";
import attachmentsRouter from "./attachments";
import officeRouter from "./office";
import officeDriveRouter from "./officeDrive";
import officePushRouter from "./officePush";
import officeSharesRouter from "./officeShares";

const router: IRouter = Router();

router.use(authRouter);
router.use(officeSharesRouter);
router.use(attachmentsRouter);
router.use(officePushRouter);
router.use(officeRouter);
router.use(officeDriveRouter);

export default router;

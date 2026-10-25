import { Router, type IRouter } from "express";
import attachmentsRouter from "./attachments";
import officeRouter from "./office";

const router: IRouter = Router();

router.use(attachmentsRouter);
router.use(officeRouter);

export default router;

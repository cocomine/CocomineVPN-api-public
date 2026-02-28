import {Worker} from "worker_threads";
import {discord_notify} from "../Notify_service";
import {Discord_VM_startup_banner_notify_job} from "./Discord_VM_startup_banner_notify_job";


jest.mock("worker_threads");
jest.mock("../Notify_service");


describe('Discord_VM_startup_banner_notify', () => {
    let bannerNotify: Discord_VM_startup_banner_notify_job;

    beforeEach(() => {
        bannerNotify = new Discord_VM_startup_banner_notify_job("Test message");
    });

    it('should set text message correctly', () => {
        bannerNotify.setTextMsg("New test message");
        expect(bannerNotify['textMsg']).toBe("New test message");
    });

    it('should set banner properties correctly', () => {
        bannerNotify.setBannerProperty("Test message", "Test time", "us");
        expect(bannerNotify['msg']).toBe("Test message");
        expect(bannerNotify['expTime']).toBe("Test time");
        expect(bannerNotify['country']).toBe("us");
    });

    it('should call discord_notify with text message if msg, expTime, and country are not set', async () => {
        await bannerNotify.send();
        expect(discord_notify).toHaveBeenCalledWith("Test message");
    });

    it('should create a banner if msg, expTime, and country are set', () => {
        bannerNotify.setBannerProperty("Test message", "Test time", "us");
        bannerNotify.send();
        expect(Worker.prototype.postMessage).toHaveBeenCalledWith(expect.objectContaining({
            msg: "Test message",
            expTime: "Test time",
            country: "us",
            jobId: expect.any(String)
        }));
    });


});
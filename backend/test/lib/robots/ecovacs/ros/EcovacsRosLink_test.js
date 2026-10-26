const assert = require("node:assert");
const { describe, it } = require("node:test");

const EcovacsRosLink = require("../../../../../lib/robots/ecovacs/ros/EcovacsRosLink");

function fakeGraph() {
    const subs = {};
    const calls = [];
    const client = {
        subscribe: (topic, handlers) => {
            subs[topic] = { handlers: handlers, closed: false };
            return {
                close: () => {
                    subs[topic].closed = true;
                }
            };
        },
        callService: async (service, request, options) => {
            calls.push({ service: service, request: request, options: options });
            return Buffer.from("map-bytes");
        }
    };
    return { subs: subs, calls: calls, client: client };
}

function fakeRobot() {
    const robot = {
        robotStates: [], workStates: [], dockInfos: [], maps: [],
        lastRobotState: null, lastDockPose: null,
        handleRobotState: b => {
            robot.robotStates.push(b);
            robot.lastRobotState = { pose: { x: 1, y: 2, theta: 3 } };
        },
        handleWorkState: b => {
            robot.workStates.push(b);
        },
        handleChargerDockInfo: b => {
            robot.dockInfos.push(b);
            robot.lastDockPose = { x: 4, y: 5, theta: 6 };
        },
        handleMapData: async (payload, poses) => {
            robot.maps.push({ payload: payload, poses: poses });
        }
    };
    return robot;
}

describe("EcovacsRosLink", () => {
    it("subscribes to the three state topics and routes messages", () => {
        const graph = fakeGraph();
        const robot = fakeRobot();
        const link = new EcovacsRosLink({ robot: robot, client: graph.client, mapPollIntervalMs: 0, robotStateIntervalMs: 0 });
        link.start();

        assert.deepStrictEqual(Object.keys(graph.subs).sort(), ["/map/ChargerDockInfo", "/robot/Robot", "/task/WorkState"]);
        graph.subs["/robot/Robot"].handlers.onMessage(Buffer.from("r"));
        graph.subs["/task/WorkState"].handlers.onMessage(Buffer.from("w"));
        graph.subs["/map/ChargerDockInfo"].handlers.onMessage(Buffer.from("d"));

        assert.strictEqual(robot.robotStates.length, 1);
        assert.strictEqual(robot.workStates.length, 1);
        assert.strictEqual(robot.dockInfos.length, 1);

        link.stop();
        assert.ok(Object.values(graph.subs).every(s => {
            return s.closed;
        }));
    });

    it("throttles the 50 Hz robot state topic", () => {
        const graph = fakeGraph();
        const robot = fakeRobot();
        const link = new EcovacsRosLink({ robot: robot, client: graph.client, mapPollIntervalMs: 0, robotStateIntervalMs: 1000 });
        link.start();
        for (let i = 0; i < 50; i++) {
            graph.subs["/robot/Robot"].handlers.onMessage(Buffer.from("r"));
        }
        link.stop();

        assert.strictEqual(robot.robotStates.length, 1);
    });

    it("polls the map service and passes the latest poses", async () => {
        const graph = fakeGraph();
        const robot = fakeRobot();
        const link = new EcovacsRosLink({ robot: robot, client: graph.client, mapPollIntervalMs: 0, robotStateIntervalMs: 0 });
        link.start();
        graph.subs["/robot/Robot"].handlers.onMessage(Buffer.from("r"));
        graph.subs["/map/ChargerDockInfo"].handlers.onMessage(Buffer.from("d"));
        await link.pollMap();
        link.stop();

        assert.strictEqual(graph.calls.length, 1);
        assert.strictEqual(graph.calls[0].service, "/map/GetCurrentCompressMap");
        assert.deepStrictEqual([...graph.calls[0].request], [0, 0, 0, 0, 0]);
        assert.strictEqual(robot.maps.length, 1);
        assert.strictEqual(robot.maps[0].payload.toString(), "map-bytes");
        assert.deepStrictEqual(robot.maps[0].poses, { robot: { x: 1, y: 2, theta: 3 }, charger: { x: 4, y: 5, theta: 6 } });
    });

    it("survives a failing map service", async () => {
        const graph = fakeGraph();
        graph.client.callService = async () => {
            throw new Error("no such service");
        };
        const robot = fakeRobot();
        const link = new EcovacsRosLink({ robot: robot, client: graph.client, mapPollIntervalMs: 0 });
        link.start();
        await link.pollMap();
        link.stop();

        assert.strictEqual(robot.maps.length, 0);
    });
});

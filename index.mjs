import {setTimeout} from "node:timers/promises";
import {randomUUID} from "node:crypto";

const channel = new BroadcastChannel("test");

const inProgress = {};

process.on("unhandledRejection", (error, promise) => {
	console.error("UNHANDLED REJECTION", error, promise);
});

new BroadcastChannel("test").addEventListener("message", (msg) => {
	console.log("debug", msg.data);
})

channel.addEventListener("message", ({data: {type, key}}) => {
	if (type === "start") {
		if (inProgress[key] === undefined) {
			inProgress[key] = new Promise((res, rej) => {
				const handler = ({data: msg}) => {
					if (msg.key === key && ["finish", "finish_error"].includes(msg.type)) {
						channel.removeEventListener("message", handler);
						delete inProgress[key];
						if (msg.type === "finish_error") {
							rej(msg.reason);
						}else {
							res();
						}
					}
				}
				channel.addEventListener("message", handler);
				channel.postMessage({type: "startack", key});
			});
			// this fixes case #3
			//inProgress[key].catch(() => {});
		}else {
			channel.postMessage({type: "inprogress", key});
			inProgress[key].finally(() => {
			// this fixes case #4
			//inProgress[key].catch(() => {}).then(() => {
				channel.postMessage({type: "finished", key});
			});
		}
	}
});

const postTask = (key, fn) => {
	if (inProgress[key] === undefined) {
		return inProgress[key] = (async () => {
			// do something async...
			await setTimeout(1);
			return fn();
		})();
	}else {
		return inProgress[key];
	}
}

const postToChannel = ({key, ...rest}, waitFor) => new Promise((res) => {
	const channel = new BroadcastChannel("test");
	if (waitFor) {
		const handler = ({data: msg}) => {
			if (msg.key === key && msg.type === waitFor) {
				channel.removeEventListener("message", handler);
				res();
			}
		}
		channel.addEventListener("message", handler);
	}
	channel.postMessage({key, ...rest});
	if (!waitFor) {
		res();
	}
});

{
	const key = randomUUID();
	console.log("\n(case #1): starting work remotely, waiting locally");

	await postToChannel({type: "start", key}, "startack");

	postTask(key, () => {console.log("called")});

	await postToChannel({type: "finish", key});
	await setTimeout(100);
}

{
	const key = randomUUID();
	console.log("\n(case #2): starting work remotely, not waiting locally");
	await postToChannel({type: "start", key}, "startack");
	await postToChannel({type: "finish", key});
	await setTimeout(100);
}

{
	const key = randomUUID();
	console.log("\n(case #3): starting work remotely, not waiting locally, task is error");
	await postToChannel({type: "start", key}, "startack");
	await postToChannel({type: "finish_error", key, reason: "failed #3"});
	await setTimeout(100);
}

{
	const key = randomUUID();
	console.log("\n(case #4): starting work remotely twice, task is error");
	await postToChannel({type: "start", key}, "startack");
	await postToChannel({type: "start", key}, "inprogress");
	await postToChannel({type: "finish_error", key, reason: "failed #4"});
	await setTimeout(100);
}

const withResolvers = () => {
	let resolve, reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return {promise, resolve, reject};
}
{
	const key = randomUUID();
	console.log("\n(case #5): starting work locally, resolve");
	const {promise, resolve} = withResolvers();
	const result = postTask(key, () => promise);
	resolve();
	await result;
	await setTimeout(100);
}
{
	const key = randomUUID();
	console.log("\n(case #6): starting work locally, reject");
	const {promise, reject} = withResolvers();
	const result = postTask(key, () => promise);
	result.catch(() => {});
	reject("failed #6");
	await setTimeout(100);
}
{
	const key = randomUUID();
	console.log("\n(case #7): starting work locally, reject after called");
	const {promise, reject} = withResolvers();
	const {promise: calledPromise, resolve: calledResolve} = withResolvers();
	const result = postTask(key, () => {
		calledResolve();
		return promise;
	});
	await calledPromise;
	reject("failed #7");
	await result.catch(() => {});
	await setTimeout(100);
}

process.exit();


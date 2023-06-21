import {
  IAgentContext,
  IDIDManager,
  IKeyManager,
  ICredentialPlugin,
} from "@veramo/core";
import { IDIDComm, IDIDCommMessage } from "@veramo/did-comm";
import { IDataStore, IDataStoreORM } from "../data-store/index.js";
import { AbstractMessageHandler, Message } from "@veramo/message-handler";
import { ariesMessageTypesPresentation } from "../types/types.js";
import { createPresentation, saveMessage } from "../utils.js";
import { v4 } from "uuid";

type IContext = IAgentContext<
  IDIDManager &
    IKeyManager &
    IDIDComm &
    IDataStore &
    ICredentialPlugin &
    IDataStoreORM
>;

export class PresentProofHandler extends AbstractMessageHandler {
  constructor() {
    super();
  }

  async handle(message: Message, context: IContext): Promise<Message> {
    const messageType = message.type;
    if (messageType == ariesMessageTypesPresentation.PROPOSE_PRESENTATION) {
      console.log("Recieved Message from: " + message.from);
      console.log("Message type: " + messageType);
      console.log("Propose Presentation: " + message.id);
    }
    if (messageType == ariesMessageTypesPresentation.REQUEST_PRESENTATION) {
      console.log("Recieved Message from: " + message.from);
      console.log("Message type: " + messageType);
      console.log("Request Presentation: " + message.id);

      let attach;
      let subject;
      let verifier;

      try {
        attach = message.data["request_presentations~attach"][0].data;
        subject = message.to as string;
        verifier = message.from as string;
      } catch (error) {
        console.log(error);
        return message;
      }

      const ariesPresentation = await createPresentation(
        attach,
        subject,
        verifier,
        context
      );

      if (ariesPresentation == undefined) {
        return message;
      }

      const msgId = v4();

      const offerCredential = {
        "@type": ariesMessageTypesPresentation.PRESENTATION,
        "@id": msgId,
        comment: "Here you have the presentation requested",
        formats: ariesPresentation?.formats,
        "presentations~attach": ariesPresentation?.["presentations~attach"],
      };

      const offerMessage: IDIDCommMessage = {
        type: ariesMessageTypesPresentation.PRESENTATION,
        to: subject,
        from: verifier,
        id: msgId,
        body: offerCredential,
      };

      const packedMessage = await context.agent.packDIDCommMessage({
        packing: "jws",
        message: offerMessage,
      });
      try {
        context.agent
          .sendDIDCommMessage({
            messageId: msgId,
            packedMessage,
            recipientDidUrl: subject,
          })
          .then(() => {
            console.log("Sent Presentation: " + msgId);
          });
      } finally {
        await saveMessage(offerMessage, context);
      }
    }
    if (messageType == ariesMessageTypesPresentation.PRESENTATION) {
      console.log("Recieved Message from: " + message.from);
      console.log("Message type: " + messageType);
      console.log("Presentation: " + message.id);

      let attach;
      try {
        attach = message.data["presentations~attach"][0].data;
      } catch (error) {}

      // Get challenge from previous request message
      let requestMessages;
      try {
        requestMessages = await context.agent.dataStoreORMGetMessages({
          where: [
            { column: "from", value: [message.to as string] },
            {
              column: "type",
              value: [ariesMessageTypesPresentation.REQUEST_PRESENTATION],
            },
          ],
        });
        if (requestMessages.length == 0) {
          console.log("Not found previous Request Presentation");
        } else {
          console.log("Found " + requestMessages.length + " Messages");
          const messageData = requestMessages[requestMessages.length - 1]
            .data as any;
          const challenge =
            messageData["request_presentations~attach"][0].data.options
              .challenge;

          console.log("Challenge:" + challenge);
          const result = await context.agent.verifyPresentation({
            presentation: attach,
            challenge: challenge,
          });
          console.log("Verified Presentation: " + result.verified);
          if (!result.verified) {
            console.log("Verification error: " + result.error);
          } else {
            const saveResult =
              await context.agent.dataStoreSaveVerifiablePresentation({
                verifiablePresentation: attach,
              });
            console.log("Saved Verifiable Presentation: " + saveResult);
          }
        }
      } catch (error) {}
    }
    return super.handle(message, context);
  }
}